package memogit

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// PushResult summarizes a push run.
type PushResult struct {
	Created   int
	Updated   int
	Archived  int
	Unchanged int
	Conflicts []string // repo-relative paths skipped because both sides changed
}

// Push syncs local file changes back to the server: new files become memos
// (CreateMemo), edited tracked files update their memo's content
// (UpdateMemo, content-only), and tracked files deleted locally archive their
// memo (soft delete). Before updating a changed file it re-checks the server:
// if the server also changed since the last sync, the file is reported as a
// conflict and left for manual resolution (run `memogit pull` first).
//
// dryRun prints the plan without calling the API, mutating sync-state, or
// committing. Attachments are one-way (download only) and never pushed.
func Push(ctx context.Context, root string, cfg *Config, dryRun bool, out io.Writer) (*PushResult, error) {
	state, err := LoadState(root)
	if err != nil {
		return nil, err
	}
	if cfg.Workspace == "" {
		return nil, fmt.Errorf("config missing workspace; re-run `memogit clone` (older config?)")
	}
	client := NewClient(cfg)
	contentRoot := ContentRoot(root, cfg)
	pathIndex := state.PathIndex()

	present, err := listDocFiles(contentRoot)
	if err != nil {
		return nil, err
	}

	res := &PushResult{}
	if dryRun {
		fmt.Fprintln(out, "Dry run — no changes will be sent.")
	}

	// 1. New + modified local files (deterministic order for stable output).
	for _, relPath := range present {
		// PDF stubs are generated, not editable content — never push them.
		if docTypeFromExt(relPath) == "PDF" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(contentRoot, relPath))
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", relPath, err)
		}
		content := string(data)
		localHash := CanonicalHash(content)

		uid, tracked := pathIndex[relPath]
		if !tracked {
			// New document → CreateMemo.
			folderPath, title, docType := deriveMemoFromPath(relPath)
			fmt.Fprintf(out, "  + %s (new)\n", relPath)
			if dryRun {
				res.Created++
				continue
			}
			created, err := client.CreateMemo(ctx, cfg.Workspace, folderPath, title, docType, content)
			if err != nil {
				return nil, err
			}
			ms := memoState(created)
			ms.Path = relPath // keep the local mapping even if the server normalized title
			state.Memos[uidFromName(created.GetName())] = ms
			res.Created++
			continue
		}

		prev := state.Memos[uid]
		if prev.DocType == "PDF" {
			continue
		}

		// A document already flagged as a conflict is only pushable once the user
		// has merged and deleted its "<path>.remote" sidecar.
		if prev.ConflictServerHash != "" {
			if conflictSidecarExists(contentRoot, relPath) {
				res.Conflicts = append(res.Conflicts, relPath)
				fmt.Fprintf(out, "  ⚠ %s: unresolved conflict — merge and delete %s, then push\n",
					relPath, conflictSidecarRel(relPath))
				continue
			}
			// Sidecar gone → resolved. Push only if the server hasn't moved again
			// since the conflict was recorded.
			serverMemo, err := client.GetMemo(ctx, uid)
			if err != nil {
				return nil, err
			}
			if CanonicalHash(serverMemo.GetContent()) != prev.ConflictServerHash {
				// Server changed again → re-open the conflict with fresh content.
				if !dryRun {
					if err := writeConflictSidecar(contentRoot, relPath, serverMemo.GetContent()); err != nil {
						return nil, err
					}
					p := prev
					p.ConflictServerHash = CanonicalHash(serverMemo.GetContent())
					state.Memos[uid] = p
				}
				res.Conflicts = append(res.Conflicts, relPath)
				fmt.Fprintf(out, "  ⚠ %s: server changed again — new %s written, merge again\n",
					relPath, conflictSidecarRel(relPath))
				continue
			}
			fmt.Fprintf(out, "  ~ %s (resolved conflict)\n", relPath)
			if dryRun {
				res.Updated++
				continue
			}
			updated, err := client.UpdateMemoContent(ctx, uid, content)
			if err != nil {
				return nil, err
			}
			ms := memoState(updated)
			ms.Path = prev.Path
			ms.Attachments = prev.Attachments
			state.Memos[uid] = ms // ConflictServerHash cleared (fresh memoState)
			res.Updated++
			continue
		}

		if localHash == prev.ContentHash {
			res.Unchanged++
			continue
		}

		// Local file changed → make sure the server hasn't also moved on.
		serverMemo, err := client.GetMemo(ctx, uid)
		if err != nil {
			return nil, err
		}
		if CanonicalHash(serverMemo.GetContent()) != prev.ContentHash {
			// Both sides changed → write the server version to "<path>.remote" for
			// the user to merge, record the conflict, and skip.
			if !dryRun {
				if err := writeConflictSidecar(contentRoot, relPath, serverMemo.GetContent()); err != nil {
					return nil, err
				}
				p := prev
				p.ConflictServerHash = CanonicalHash(serverMemo.GetContent())
				state.Memos[uid] = p
			}
			res.Conflicts = append(res.Conflicts, relPath)
			fmt.Fprintf(out, "  ⚠ %s: conflict — server version written to %s, merge and delete it, then push\n",
				relPath, conflictSidecarRel(relPath))
			continue
		}

		fmt.Fprintf(out, "  ~ %s (modified)\n", relPath)
		if dryRun {
			res.Updated++
			continue
		}
		updated, err := client.UpdateMemoContent(ctx, uid, content)
		if err != nil {
			return nil, err
		}
		ms := memoState(updated)
		ms.Path = prev.Path
		ms.Attachments = prev.Attachments
		state.Memos[uid] = ms
		res.Updated++
	}

	// 2. Tracked files deleted locally → archive the memo (soft delete).
	presentSet := make(map[string]bool, len(present))
	for _, p := range present {
		presentSet[p] = true
	}
	for _, uid := range sortedUIDs(state) {
		prev := state.Memos[uid]
		if presentSet[prev.Path] {
			continue
		}
		fmt.Fprintf(out, "  - %s (deleted → archive)\n", prev.Path)
		if dryRun {
			res.Archived++
			continue
		}
		if err := client.ArchiveMemo(ctx, uid); err != nil {
			return nil, err
		}
		delete(state.Memos, uid)
		res.Archived++
	}

	if dryRun {
		fmt.Fprintf(out, "Dry run: %d to create, %d to update, %d to archive, %d unchanged, %d conflicts.\n",
			res.Created, res.Updated, res.Archived, res.Unchanged, len(res.Conflicts))
		return res, nil
	}

	state.LastSync = time.Now().UTC()
	if err := state.Save(root); err != nil {
		return nil, err
	}
	if err := GitCommitAll(root, fmt.Sprintf("memogit push: %d created, %d updated, %d archived", res.Created, res.Updated, res.Archived)); err != nil {
		return nil, err
	}

	fmt.Fprintf(out, "Push complete: %d created, %d updated, %d archived, %d unchanged, %d conflicts.\n",
		res.Created, res.Updated, res.Archived, res.Unchanged, len(res.Conflicts))
	if len(res.Conflicts) > 0 {
		fmt.Fprintf(out, "Conflicts left for manual resolution: %v\n", res.Conflicts)
	}
	return res, nil
}

// listDocFiles returns every document file under contentRoot (repo-relative to
// contentRoot), sorted, skipping the attachments directory and any dotfiles.
func listDocFiles(contentRoot string) ([]string, error) {
	var out []string
	err := filepath.WalkDir(contentRoot, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) {
				return nil // content root not created yet (empty workspace)
			}
			return err
		}
		if d.IsDir() {
			if d.Name() == attachmentsDir || strings.HasPrefix(d.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasPrefix(d.Name(), ".") || isConflictSidecar(d.Name()) {
			return nil // dotfiles and conflict sidecars are not documents
		}
		rel, err := filepath.Rel(contentRoot, p)
		if err != nil {
			return err
		}
		out = append(out, rel)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("scan work tree: %w", err)
	}
	sort.Strings(out)
	return out, nil
}

// deriveMemoFromPath recovers a new memo's folder_path, title, and doc_type from
// its repo-relative file path. Title/folder derivation is best-effort: filename
// sanitization on the way down is lossy, so titles with reserved characters may
// not round-trip exactly (the server assigns the canonical value).
func deriveMemoFromPath(relPath string) (folderPath, title, docType string) {
	docType = docTypeFromExt(relPath)
	title = stripDocExt(filepath.Base(relPath))
	if dir := filepath.Dir(relPath); dir != "." {
		folderPath = filepath.ToSlash(dir)
	}
	return folderPath, title, docType
}

// sortedUIDs returns the state's memo uids in a stable order for deterministic
// archive output.
func sortedUIDs(state *State) []string {
	uids := make([]string, 0, len(state.Memos))
	for uid := range state.Memos {
		uids = append(uids, uid)
	}
	sort.Strings(uids)
	return uids
}
