package memogit

import (
	_ "embed"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// GuideFile is the agent-facing manual dropped into the checkout metadata dir.
// It is a verbatim copy of docs/manual/pumpkin_book_for_llms.md, embedded so a
// checkout carries its own instructions without needing the server repo.
const GuideFile = "toucanshelf-guide.md"

//go:embed assets/pumpkin_book_for_llms.md
var guideDoc string

// Markers delimiting the block memogit owns inside AGENTS.md / CLAUDE.md, so a
// user's own instructions in those files survive regeneration.
const (
	agentBlockBegin = "<!-- BEGIN memogit (managed block; memogit rewrites it — put your own notes outside) -->"
	agentBlockEnd   = "<!-- END memogit -->"
)

// agentBrief is the short, always-loaded pointer: the few rules an agent must
// know before its first edit, plus a link to the full guide.
const agentBrief = `## ToucanShelf 知识库检出目录（给 AI 代理看）

这个目录**不是普通的 Markdown 仓库**，而是一个 ToucanShelf（memos fork）知识库的
本地投影，由 ` + "`memogit`" + ` 检出。文件里有非标准语法和同步契约，踩到会静默丢数据
或制造假冲突。

> **动手改任何文件之前，先完整读一遍 [` + "`" + MetaDir + "/" + GuideFile + "`" + `](` + MetaDir + `/` + GuideFile + `)。**

最容易犯的几个错（细节见手册对应章节）：

1. 每篇文档**末尾**的 ` + "`<!-- memogit-id: memos/<uid> -->`" + `（` + "`.view.json`" + ` 里是顶层
   ` + "`\"memogit-id\"`" + ` 键）是文档身份证：**别删、别改、别在新建文件里手写**；移动或
   重命名用 ` + "`mv`" + `，让它跟着文件走。
2. **别加 memogit 头部**。文件里第一个 ` + "`---`" + ` 块永远属于用户自己的 Obsidian
   frontmatter（喂给视图/看板的属性）。
3. ` + "`" + MetaDir + "/`" + ` 是元数据，不要手改：` + "`" + ConfigFile + "`" + ` 含访问令牌（别读出、别外传、
   别提交），` + "`" + StateDir + "/`" + ` 是同步基线。
4. ` + "`*.view.json`" + `、` + "`*.pdf.md`" + `、` + "`*.html`" + ` 是特殊 doc_type，不是普通 Markdown，
   改法各不相同；` + "`_attachments/`" + ` 是只读的附件字节。
5. 同步节奏：先 ` + "`memogit pull`" + `，改完 ` + "`memogit status`" + ` 自查，再 ` + "`memogit push`" + `
   （可先 ` + "`--dry-run`" + `）。不要用 ` + "`git push`" + `，本地 git 只是快照，没有 remote。
`

// workspaceHeader prefixes the brief inside a workspace subfolder, where the
// agent's working directory is one knowledge base rather than the checkout
// root. Takes the subfolder name.
const workspaceHeader = "> 你在 `%s/` 里，这是检出根 `../` 下的**一个知识库**。凭证与同步元数据在\n" +
	"> `../" + MetaDir + "/`（其中 `" + ConfigFile + "` 含令牌，别读别传），`memogit` 命令在根目录跑。\n\n"

// claudePointer keeps CLAUDE.md thin: Claude Code loads it automatically, and
// it just redirects to the same managed block. Takes the guide's relative path
// twice (link text and target).
const claudePointer = "本目录的代理须知见 [`AGENTS.md`](AGENTS.md)，完整手册见 [`%s`](%s)。" +
	"**改任何文件前先读手册。**\n"

// cursorRule is Cursor's project-rule format: frontmatter + body, always
// applied so the brief is in context for every request in this folder.
const cursorRule = "---\ndescription: ToucanShelf/memogit 知识库检出目录的编辑契约\nalwaysApply: true\n---\n\n"

// agentDocNames are the entry-point files memogit generates inside the tree.
// push must never mistake them for knowledge-base documents.
var agentDocNames = map[string]bool{"AGENTS.md": true, "CLAUDE.md": true}

// isAgentDoc reports whether a file name is one of memogit's generated agent
// entry points (the .cursor rule lives in a dotdir and is skipped already).
func isAgentDoc(name string) bool { return agentDocNames[name] }

// WriteAgentDocs makes the checkout self-describing to coding agents: it drops
// the embedded manual into the metadata dir and wires up the entry points each
// agent reads on its own (AGENTS.md for Codex/others, CLAUDE.md for Claude
// Code, .cursor/rules for Cursor). Regenerating only rewrites memogit's own
// managed block, so anything the user added around it is preserved.
//
// The guide is written once, at the root, because that is where the checkout's
// identity lives. But an agent is often started inside a single knowledge base
// (<root>/<workspace>/) rather than at the root, so each workspace subfolder
// gets its own entry points too, pointing back up at the one guide. cfg may be
// nil, in which case only the root files are written.
func WriteAgentDocs(root string, cfg *Config, out io.Writer) error {
	guide := filepath.Join(root, MetaDir, GuideFile)
	if err := os.MkdirAll(filepath.Dir(guide), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(guide, []byte(guideDoc), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", guide, err)
	}
	// A knowledge base cloned before these files existed may already contain a
	// document named AGENTS.md or CLAUDE.md. Never write over one: the block
	// would corrupt the user's document and get pushed to the server.
	taken := trackedEntryPoints(root, cfg, out)

	if err := writeEntryPoints(root, "", taken); err != nil {
		return err
	}

	dirs := workspaceDirs(cfg)
	for _, dir := range dirs {
		if err := writeEntryPoints(filepath.Join(root, dir), dir, taken); err != nil {
			return err
		}
	}
	if out != nil {
		fmt.Fprintf(out, "Agent guide written to %s (entry points: AGENTS.md, CLAUDE.md, .cursor/rules/ at the root",
			filepath.Join(MetaDir, GuideFile))
		if len(dirs) > 0 {
			fmt.Fprintf(out, " and in %s", strings.Join(dirs, ", "))
		}
		fmt.Fprintln(out, ").")
	}
	return nil
}

// workspaceDirs lists the workspace subfolders that need their own entry
// points: every cloned workspace except a sparse checkout mapped onto the root
// itself (Dir "."), which the root files already cover.
func workspaceDirs(cfg *Config) []string {
	if cfg == nil {
		return nil
	}
	var dirs []string
	for _, ws := range cfg.Workspaces {
		if ws.Dir == "" || ws.Dir == "." {
			continue
		}
		dirs = append(dirs, ws.Dir)
	}
	return dirs
}

// trackedPaths indexes the document paths a state records, relative to that
// workspace's content root, in slash form. Returns nil for a nil state.
func trackedPaths(state *State) map[string]bool {
	if state == nil {
		return nil
	}
	paths := make(map[string]bool, len(state.Memos))
	for _, ms := range state.Memos {
		paths[filepath.ToSlash(ms.Path)] = true
	}
	return paths
}

// trackedEntryPoints returns the checkout-relative paths where an entry-point
// file name is taken by a real tracked document, so generation can leave it
// alone. Unreadable state files are ignored: at clone time none exist yet.
func trackedEntryPoints(root string, cfg *Config, out io.Writer) map[string]bool {
	taken := map[string]bool{}
	if cfg == nil {
		return taken
	}
	for _, ws := range cfg.Workspaces {
		state, err := LoadState(root, ws.stateName())
		if err != nil {
			continue
		}
		for path := range trackedPaths(state) {
			if !isAgentDoc(filepath.Base(path)) {
				continue
			}
			rel := filepath.ToSlash(filepath.Join(ws.Dir, path))
			taken[rel] = true
			if out != nil {
				fmt.Fprintf(out, "  note: %s is one of your documents — agent entry point not written there.\n", rel)
			}
		}
	}
	return taken
}

// writeEntryPoints writes the three agent entry points into dir. subdir is the
// directory's path relative to the checkout root ("" for the root itself); it
// is used to point the links back up at the single copy of the guide. Paths in
// taken belong to real documents and are left untouched.
func writeEntryPoints(dir, subdir string, taken map[string]bool) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	guideLink := MetaDir + "/" + GuideFile
	brief := agentBrief
	if subdir != "" {
		guideLink = "../" + guideLink
		brief = fmt.Sprintf(workspaceHeader, subdir) + strings.ReplaceAll(agentBrief, MetaDir+"/"+GuideFile, guideLink)
	}
	if !taken[filepath.ToSlash(filepath.Join(subdir, "AGENTS.md"))] {
		if err := upsertManagedBlock(filepath.Join(dir, "AGENTS.md"), brief); err != nil {
			return err
		}
	}
	pointer := fmt.Sprintf(claudePointer, guideLink, guideLink)
	if !taken[filepath.ToSlash(filepath.Join(subdir, "CLAUDE.md"))] {
		if err := upsertManagedBlock(filepath.Join(dir, "CLAUDE.md"), pointer); err != nil {
			return err
		}
	}
	rule := filepath.Join(dir, ".cursor", "rules", "toucanshelf-memogit.mdc")
	if err := os.MkdirAll(filepath.Dir(rule), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(rule, []byte(cursorRule+brief), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", rule, err)
	}
	return nil
}

// upsertManagedBlock writes body between memogit's markers in path: replacing
// the existing block if present, appending it otherwise, creating the file when
// it doesn't exist. Text outside the markers is never touched.
func upsertManagedBlock(path, body string) error {
	block := agentBlockBegin + "\n" + body + agentBlockEnd + "\n"

	existing, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			return err
		}
		return os.WriteFile(path, []byte(block), 0o644)
	}

	text := string(existing)
	start := strings.Index(text, agentBlockBegin)
	if start < 0 {
		sep := "\n\n"
		if strings.HasSuffix(text, "\n\n") || text == "" {
			sep = ""
		} else if strings.HasSuffix(text, "\n") {
			sep = "\n"
		}
		return os.WriteFile(path, []byte(text+sep+block), 0o644)
	}
	end := strings.Index(text[start:], agentBlockEnd)
	if end < 0 {
		// Truncated/hand-edited block: replace everything from the marker on.
		return os.WriteFile(path, []byte(text[:start]+block), 0o644)
	}
	tail := text[start+end+len(agentBlockEnd):]
	tail = strings.TrimPrefix(tail, "\n")
	return os.WriteFile(path, []byte(text[:start]+block+tail), 0o644)
}
