package test

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
)

// TestMemoLinkMoveRepairKeepsReferencerLayout guards the regression where a
// move's inbound-link repair re-rendered every referencing document: tables
// came back as one line of run-together cell text and list continuation lines
// lost their indentation. The referencer is someone else's document, so the
// repair may change the link and nothing else.
func TestMemoLinkMoveRepairKeepsReferencerLayout(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateHostUser(ctx, "user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	target, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Plan", Content: "target"},
	})
	require.NoError(t, err)

	referencerContent := "# Index\n" +
		"\n" +
		"| # | Doc | Note |\n" +
		"| --- | --- | --- |\n" +
		"| 1 | [Plan](/Plan) | first |\n" +
		"| 2 | other | second |\n" +
		"\n" +
		"- see [Plan](/Plan)\n" +
		"  continued on a second line\n" +
		"- item two\n"
	referencer, err := ts.Service.CreateMemo(userCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{Title: "Index", Content: referencerContent},
	})
	require.NoError(t, err)

	_, err = ts.Service.CreateWorkspaceFolder(userCtx, &apiv1.CreateWorkspaceFolderRequest{
		Parent: "workspaces/" + defaultWorkspaceUID(t, ctx, ts, user.ID),
		Folder: &apiv1.WorkspaceFolder{Path: "Campaigns"},
	})
	require.NoError(t, err)
	_, err = ts.Service.UpdateMemo(userCtx, &apiv1.UpdateMemoRequest{
		Memo:       &apiv1.Memo{Name: target.Name, FolderPath: "Campaigns"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"folder_path"}},
	})
	require.NoError(t, err)

	got, err := ts.Service.GetMemo(userCtx, &apiv1.GetMemoRequest{Name: referencer.Name})
	require.NoError(t, err)
	require.Equal(t, strings.ReplaceAll(referencerContent, "(/Plan)", "(/Campaigns/Plan)"), got.Content)
}
