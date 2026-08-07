// Package linkindex resolves cross-document markdown link hrefs to target
// memo uids, so the server can build and maintain a reverse-link index. It
// ports the relative-path + title-fallback resolution algorithm implemented
// on the frontend in web/src/components/MemoContent/DocumentLinkContext.tsx
// (resolveWorkspacePath), so links saved server-side resolve the same way
// they render client-side.
package linkindex

import "strings"

// TreeNode is a workspace folder-tree node used for relative-path/title
// resolution, mirroring the shape of the frontend's WorkspaceTreeNode
// closely enough to port its matching logic.
type TreeNode struct {
	// Name is the folder name for folder nodes, or the document title for
	// document nodes.
	Name     string
	IsFolder bool
	// UID is the memo's uid; only set on document nodes.
	UID      string
	Children []*TreeNode
}

// DocRef is the minimal per-document data needed to build a TreeNode tree.
type DocRef struct {
	UID        string
	Title      string
	FolderPath string // slash-separated, relative to workspace root; "" means root
}

// BuildTree groups a flat list of documents into a folder tree by
// FolderPath, matching how the frontend workspace tree is derived.
func BuildTree(docs []DocRef) []*TreeNode {
	root := &TreeNode{IsFolder: true}
	for _, doc := range docs {
		cur := root
		for _, seg := range splitPath(doc.FolderPath) {
			cur = ensureFolder(cur, seg)
		}
		cur.Children = append(cur.Children, &TreeNode{Name: doc.Title, UID: doc.UID})
	}
	return root.Children
}

// FindNodeByUID does a DFS over the tree for the document node with the
// given UID, returning nil if none matches. Callers use this to patch a
// node's Name in place (e.g. to resolve links against a document's title as
// it stood before a rename); folder nodes never match since they carry no
// UID.
func FindNodeByUID(nodes []*TreeNode, uid string) *TreeNode {
	for _, n := range nodes {
		if !n.IsFolder && n.UID == uid {
			return n
		}
		if n.IsFolder {
			if found := FindNodeByUID(n.Children, uid); found != nil {
				return found
			}
		}
	}
	return nil
}

func ensureFolder(parent *TreeNode, name string) *TreeNode {
	for _, child := range parent.Children {
		if child.IsFolder && child.Name == name {
			return child
		}
	}
	folder := &TreeNode{Name: name, IsFolder: true}
	parent.Children = append(parent.Children, folder)
	return folder
}

func splitPath(path string) []string {
	var out []string
	for _, s := range strings.Split(path, "/") {
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}
