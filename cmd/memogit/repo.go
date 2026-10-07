package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"

	"github.com/usememos/memos/internal/memogit"
)

// The commands in this file serve downstream repos: a repo keeps a
// memogit.conf.yaml at its root, and its Claude Code hooks call
// `memogit hook session-start` / `memogit hook stop`. What a repo needs and why
// is written for agents in docs/skill/bootstrap.md, which the server publishes
// at <server>/memogit/bootstrap.md.

func syncCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "sync",
		Short: "Clone or pull every knowledge base listed in the repo's " + memogit.RepoConfigFile,
		Long: `Clone or pull every knowledge base listed in the repo's ` + memogit.RepoConfigFile + `.

The config is looked up from the current directory upwards. Knowledge bases not
checked out yet are cloned into the checkout root it names (kb/ by default);
the others are pulled. One failing knowledge base does not stop the rest.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			rc, warnings, err := loadRepoConfig()
			if err != nil {
				return err
			}
			out := cmd.OutOrStdout()
			for _, w := range warnings {
				fmt.Fprintln(cmd.ErrOrStderr(), "warning:", w)
			}
			results, err := memogit.SyncRepo(cmd.Context(), rc, out)
			if err != nil {
				return err
			}
			failed := 0
			fmt.Fprintln(out)
			for _, r := range results {
				switch {
				case r.Err != nil:
					failed++
					fmt.Fprintf(out, "  FAILED %s: %v\n", r.KB.Name, r.Err)
				case r.Cloned:
					fmt.Fprintf(out, "  ok     %s -> %s (cloned)\n", r.KB.Name, checkoutPath(rc, r.Dir))
				default:
					fmt.Fprintf(out, "  ok     %s -> %s (%d changed, %d conflicts)\n", r.KB.Name, checkoutPath(rc, r.Dir), r.Changed, r.Conflicts)
				}
			}
			if failed > 0 {
				return fmt.Errorf("%d of %d knowledge base(s) failed to sync", failed, len(results))
			}
			return nil
		},
	}
}

func hookCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "hook",
		Short: "Claude Code hook entry points for repos that keep a " + memogit.RepoConfigFile,
		Long: `Claude Code hook entry points for repos that keep a ` + memogit.RepoConfigFile + `.

  session-start   sync, then print the knowledge-base status for the agent
                  (stdout becomes session context; always exits 0)
  stop            push; conflicts and skipped documents go to stderr with
                  exit code 2 so the agent sees them

See <server>/memogit/bootstrap.md for the hook configuration.`,
	}
	cmd.AddCommand(&cobra.Command{
		Use:   "session-start",
		Short: "Sync and print the knowledge-base status for the agent",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			hookSessionStart(cmd, cmd.OutOrStdout())
			return nil
		},
	})
	cmd.AddCommand(&cobra.Command{
		Use:   "stop",
		Short: "Push, and report anything left unpushed to the agent",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if code := hookStop(cmd, cmd.InOrStdin(), cmd.ErrOrStderr()); code != 0 {
				os.Exit(code)
			}
			return nil
		},
	})
	return cmd
}

// readyMarker opens the session-start output when every knowledge base is
// ready. The CLAUDE.md block bootstrap.md asks repos to add tells the agent
// that no "memogit:" status at all means the hook never ran.
const readyMarker = "memogit: 知识库就绪"

func hookSessionStart(cmd *cobra.Command, out io.Writer) {
	rc, warnings, err := loadRepoConfig()
	if err != nil {
		fmt.Fprintf(out, "⛔ memogit: 知识库未就绪\n\n%v\n\n%s\n", err, stopAndTell(""))
		return
	}
	server := memogit.ServerFromEnv()
	if server == "" {
		server = rc.Server
	}
	results, err := memogit.SyncRepo(cmd.Context(), rc, io.Discard)
	if err != nil {
		fmt.Fprintf(out, "⛔ memogit: 知识库未就绪\n\n%v%s\n\n%s\n", err, withHint(err), stopAndTell(server))
		return
	}

	failed := 0
	for _, r := range results {
		if r.Err != nil {
			failed++
		}
	}
	switch {
	case len(results) == 0:
		fmt.Fprintf(out, "⚠ memogit: %s 里没有启用的知识库\n", memogit.RepoConfigFile)
		return
	case failed == len(results):
		fmt.Fprintln(out, "⛔ memogit: 知识库未就绪")
	case failed > 0:
		fmt.Fprintln(out, "⚠ memogit: 部分知识库未就绪")
	default:
		fmt.Fprintln(out, readyMarker)
	}
	for _, w := range warnings {
		fmt.Fprintln(out, "提示："+w)
	}

	fmt.Fprintf(out, "\n知识库检出在 %s/（memogit 检出根，不进 git；服务器 %s 是唯一数据源）：\n", rc.CheckoutDir(), server)
	for _, r := range results {
		desc := ""
		if r.KB.Desc != "" {
			desc = "：" + r.KB.Desc
		}
		if len(r.KB.Folders) > 0 {
			// The agent must know the rest of the knowledge base is not here:
			// links into other folders dangle locally, and new documents only
			// push from inside these folders.
			desc += "（只检出了 " + strings.Join(r.KB.Folders, "、") + "，其余目录不在本地）"
		}
		switch {
		case r.Err != nil:
			fmt.Fprintf(out, "- %s%s（失败：%v%s）\n", r.KB.Name, desc, r.Err, withHint(r.Err))
		case r.Conflicts > 0:
			fmt.Fprintf(out, "- %s — %s%s（已同步，有 %d 篇冲突待合并，见 *.remote）\n", checkoutPath(rc, r.Dir), r.KB.Name, desc, r.Conflicts)
		case r.Cloned:
			fmt.Fprintf(out, "- %s — %s%s（首次检出）\n", checkoutPath(rc, r.Dir), r.KB.Name, desc)
		default:
			fmt.Fprintf(out, "- %s — %s%s（已同步）\n", checkoutPath(rc, r.Dir), r.KB.Name, desc)
		}
	}

	fmt.Fprintf(out, "\n读写知识库前先读 %s/%s/%s/SKILL.md（memogit 手册，冲突怎么合并也在里面）。"+
		"改完不用手动推送：每轮结束时 Stop hook 会执行 memogit push。\n",
		rc.CheckoutDir(), memogit.MetaDir, memogit.GuideDir)
	if failed > 0 {
		fmt.Fprintf(out, "\n先把失败的知识库和原因告诉用户，只在已同步的知识库里工作，不要改用 MCP 或其他途径绕过。排查见 %s。\n",
			bootstrapURL(server))
	}
}

// hookStop pushes every checked-out knowledge base and returns the hook exit
// code: 2 when something was left unpushed (Claude Code then shows stderr to
// the agent and lets it continue), 0 otherwise. It never blocks twice in a
// row: when the agent is already continuing because of this hook
// (stop_hook_active), it only reports.
func hookStop(cmd *cobra.Command, stdin io.Reader, stderr io.Writer) int {
	var input struct {
		StopHookActive bool `json:"stop_hook_active"`
	}
	if data, err := io.ReadAll(stdin); err == nil && len(data) > 0 {
		_ = json.Unmarshal(data, &input)
	}

	rc, _, err := loadRepoConfig()
	if err != nil {
		// session-start already told the agent; nothing to push.
		return 0
	}
	root := rc.Root()
	cfg, err := memogit.LoadConfigWithServer(root, rc.Server)
	if err != nil {
		return 0
	}
	if err := memogit.Migrate(root, cfg); err != nil {
		fmt.Fprintf(stderr, "memogit push 失败：%v\n", err)
		return blockOnce(input.StopHookActive)
	}

	var problems []string
	for _, ws := range cfg.Workspaces {
		res, err := memogit.Push(cmd.Context(), root, cfg, ws, false, io.Discard)
		if err != nil {
			problems = append(problems, fmt.Sprintf("- %s：push 失败：%v%s", ws.Title, err, withHint(err)))
			continue
		}
		// Push reports paths relative to the knowledge base's content folder.
		prefix := checkoutPath(rc, ws.Dir)
		for _, p := range res.Conflicts {
			problems = append(problems, fmt.Sprintf("- 冲突 %s%s：服务器和本地都改了，服务器版本在 %s%s.remote；按手册合并后删掉 .remote，下一轮会再推", prefix, p, prefix, p))
		}
		for _, p := range res.Orphaned {
			problems = append(problems, fmt.Sprintf("- 跳过 %s%s：服务器上已归档或删除；问用户是恢复服务器上的文档还是删掉本地文件", prefix, p))
		}
	}
	if len(problems) == 0 {
		return 0
	}
	fmt.Fprintf(stderr, "memogit push：以下改动没有推上服务器，需要处理或告诉用户：\n%s\n", strings.Join(problems, "\n"))
	return blockOnce(input.StopHookActive)
}

func blockOnce(alreadyActive bool) int {
	if alreadyActive {
		return 0
	}
	return 2
}

// loadRepoConfig finds memogit.conf.yaml from the hook's project dir (Claude
// Code sets CLAUDE_PROJECT_DIR) or the current directory.
func loadRepoConfig() (*memogit.RepoConfig, []string, error) {
	start := os.Getenv("CLAUDE_PROJECT_DIR")
	if start == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return nil, nil, err
		}
		start = cwd
	}
	path := memogit.FindRepoConfig(start)
	if path == "" {
		return nil, nil, fmt.Errorf("没有找到 %s（从 %s 往上找）", memogit.RepoConfigFile, start)
	}
	return memogit.LoadRepoConfig(path)
}

// checkoutPath is a content dir as the agent sees it from the repo root,
// e.g. "kb/Career/". An empty dir gives the checkout root itself.
func checkoutPath(rc *memogit.RepoConfig, dir string) string {
	p := filepath.ToSlash(filepath.Join(rc.CheckoutDir(), dir))
	if rel, err := filepath.Rel(rc.Base(), rc.Root()); err == nil && !strings.HasPrefix(rel, "..") {
		p = filepath.ToSlash(filepath.Join(rel, dir))
	}
	return p + "/"
}

func bootstrapURL(server string) string {
	if server == "" {
		return "ToucanShelf 服务器上的 /memogit/bootstrap.md（环境变量 " + memogit.EnvToucanServer + " 没有设置）"
	}
	return memogit.DistURL(server, "bootstrap.md")
}

func stopAndTell(server string) string {
	return "停下来把上面的原因告诉用户，不要读写知识库内容，也不要改用 MCP 或其他途径绕过。排查和配置步骤见 " + bootstrapURL(server) + "。"
}

// withHint is hintFor as a "。<hint>" suffix, or "" when there is no hint.
func withHint(err error) string {
	if h := hintFor(err); h != "" {
		return "。" + h
	}
	return ""
}

// hintFor turns the usual failures into what to check.
func hintFor(err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "not configured"):
		return "需要环境变量 " + memogit.EnvToucanServer + " 和 " + memogit.EnvToucanToken + "（本机和云端环境都要配）"
	case strings.Contains(msg, "401") || strings.Contains(strings.ToLower(msg), "unauthenticated"):
		return memogit.EnvToucanToken + " 无效或已过期，需要用户换一个 Personal Access Token"
	case strings.Contains(msg, "403") || strings.Contains(strings.ToLower(msg), "forbidden"):
		return "请求被拦截：多半是云端环境的网络白名单没放行服务器域名，也可能是 Cloudflare 拦了机房 IP"
	default:
		return ""
	}
}
