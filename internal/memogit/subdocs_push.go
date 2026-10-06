package memogit

import (
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"connectrpc.com/connect"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// Pushing the ".subdocs" folders.
//
// A file in "<parent>.subdocs/" IS a sub-document of the document beside it —
// the folder name is the binding, not a location. So push never sends such a
// path to the server as a folder; it works out which document the parent is
// and binds the file to it with the reserved "_sub/<parent uid>" path:
//
//   - a new file is created as that document's sub-document;
//   - a tracked file that is not bound to it yet (an ordinary document moved
//     into the folder, or one an older memogit pushed into a real folder by
//     that name) is attached in place, keeping its uid;
//   - a bound file whose name changed is retitled; one that only moved
//     because its parent was renamed needs nothing from the server at all.
//
// What cannot be done — no parent anywhere, a sub-document of another
// document, nesting below a ".subdocs" folder — is skipped with a "!" line,
// never pushed as an ordinary document and never fatal to the rest of the run.

// pushOrder returns doc indexes with every ".subdocs" file after all other
// files, so parents created or moved in the same run are resolved first.
func pushOrder(docs []localDoc) []int {
	order := make([]int, 0, len(docs))
	var subDocs []int
	for i, doc := range docs {
		if _, isSubDoc := ParentRelFromSubDocPath(doc.Path); isSubDoc {
			subDocs = append(subDocs, i)
			continue
		}
		order = append(order, i)
	}
	return append(order, subDocs...)
}

// nestedUnderSubDocDir reports a path with a ".subdocs" folder anywhere but as
// its immediate folder — "A.subdocs/deeper/x.md", or a sub-document's own
// "A.subdocs/B.subdocs/x.md". Sub-documents are one level deep, and the server
// reserves the name, so there is no correct place to push such a file to.
func nestedUnderSubDocDir(rel string) (string, bool) {
	dirs := strings.Split(filepath.ToSlash(filepath.Dir(rel)), "/")
	for i, dir := range dirs[:len(dirs)-1] {
		if strings.HasSuffix(strings.ToLower(dir), SubDocDirSuffix) {
			return strings.Join(dirs[:i+1], "/"), true
		}
	}
	return "", false
}

// parentFinder resolves the document a ".subdocs" folder belongs to.
type parentFinder struct {
	ws *WorkspaceConfig
	// docs and byPath are the work tree as push resolved it; a doc's UID is
	// filled in as soon as it is created, so a parent new in this run is found.
	docs   []localDoc
	byPath map[string]int
	// live is the server's view, kept current as this run creates and moves
	// documents.
	live map[string]*v1pb.Memo
}

func newParentFinder(ws *WorkspaceConfig, docs []localDoc, live map[string]*v1pb.Memo) *parentFinder {
	byPath := make(map[string]int, len(docs))
	for i, doc := range docs {
		byPath[filepath.ToSlash(doc.Path)] = i
	}
	return &parentFinder{ws: ws, docs: docs, byPath: byPath, live: live}
}

// find returns the uid of the document whose file is parentRel, trying the
// work tree first (the file beside the folder, wherever it moved from and
// even if it was created moments ago) and then the server (a parent created
// on the web since the last pull has no local file yet). Neither may be a
// sub-document itself.
func (f *parentFinder) find(parentRel string) (string, bool) {
	parentRel = filepath.ToSlash(parentRel)
	if i, ok := f.byPath[parentRel]; ok {
		if uid := f.docs[i].UID; uid != "" && f.canParent(uid) {
			return uid, true
		}
	}
	for uid, m := range f.live {
		if _, isSubDoc := ParentUIDFromSubDocFolder(m.GetFolderPath()); isSubDoc {
			continue
		}
		if filepath.ToSlash(f.ws.LocalRelPath(m.GetFolderPath(), m.GetTitle(), docTypeString(m))) == parentRel {
			return uid, true
		}
	}
	return "", false
}

func (f *parentFinder) canParent(uid string) bool {
	m := f.live[uid]
	if m == nil {
		return false
	}
	_, isSubDoc := ParentUIDFromSubDocFolder(m.GetFolderPath())
	return !isSubDoc
}

// pushSubDoc pushes one file from a ".subdocs" folder. Returns the uid of a
// document it created ("" otherwise).
func pushSubDoc(ctx context.Context, client *Client, ws *WorkspaceConfig, parents parentIndex, finder *parentFinder,
	contentRoot string, doc localDoc, parentRel string, state *State, res *PushResult, dryRun bool, out io.Writer) (string, error) {
	if doc.DocType != "MARKDOWN" {
		res.skip(out, doc.Path, "only markdown documents can be sub-documents")
		return "", nil
	}
	parentUID, found := finder.find(parentRel)
	if !found {
		res.skip(out, doc.Path, "no document %s to attach it to, locally or on the server "+
			"(a %s folder holds the sub-documents of the document beside it)", parentRel, SubDocDirSuffix)
		return "", nil
	}
	folderPath := SubDocFolderPath(parentUID)
	_, title, _ := deriveMemoFromPath(doc.Path)
	// A sub-document's local path is derived from its parent's, so the parent's
	// own path has to be in the index for the state built below to be right.
	parents[parentUID] = filepath.ToSlash(parentRel)

	if doc.UID == "" {
		created, err := pushNewDoc(ctx, client, ws, parents, contentRoot, doc, folderPath, state, res, dryRun, out)
		if err != nil || created == nil {
			return "", err
		}
		uid := uidFromName(created.GetName())
		finder.live[uid] = created
		return uid, nil
	}

	current := finder.live[doc.UID]
	if current == nil {
		res.orphan(out, doc.Path)
		return "", nil
	}
	prev := state.Memos[doc.UID]
	boundTo, isSubDoc := ParentUIDFromSubDocFolder(current.GetFolderPath())
	switch {
	case isSubDoc && boundTo != parentUID:
		res.skip(out, doc.Path, "already a sub-document of another document, and a sub-document cannot change parent; "+
			"move it back to %s", prev.Path)
		return "", nil

	case isSubDoc && SubDocRelPath(parentRel, current.GetTitle()) == doc.Path:
		// Bound, and the server's title already maps to this file name: only
		// the parent moved, which takes nothing from the server.
		prev.Path = doc.Path

	default:
		verb := "attached to " + parentRel
		if isSubDoc {
			verb = "renamed"
		}
		fmt.Fprintf(out, "  ⇢ %s (%s)\n", doc.Path, verb)
		if dryRun {
			prev.Path = doc.Path
			res.Moved++
			break
		}
		moved, err := client.MoveMemo(ctx, doc.UID, folderPath, title)
		if err != nil {
			if isRefusal(err) {
				res.skip(out, doc.Path, "the server refused: %v", err)
				return "", nil
			}
			return "", err
		}
		// A server that predates in-place attaching either refuses (handled
		// above) or, older still, ignores the mask and answers 200 unchanged.
		if moved.GetFolderPath() != folderPath {
			res.skip(out, doc.Path, "the server did not attach it (too old to attach existing documents? "+
				"update the server, or attach it in the web UI)")
			return "", nil
		}
		finder.live[doc.UID] = moved
		prev = rebaseState(ws, parents, moved, doc.Path, prev)
		res.Moved++
	}
	if !dryRun {
		state.Memos[doc.UID] = prev
	}
	return "", pushDocContent(ctx, client, ws, parents, contentRoot, doc, prev, state, res, dryRun, out)
}

// isRefusal reports a server answer that is about this one request (it was
// not allowed), as opposed to a failure that would hit every request after it.
func isRefusal(err error) bool {
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		return false
	}
	switch connectErr.Code() {
	case connect.CodeInvalidArgument, connect.CodeAlreadyExists, connect.CodeNotFound,
		connect.CodeFailedPrecondition, connect.CodePermissionDenied:
		return true
	default:
		return false
	}
}
