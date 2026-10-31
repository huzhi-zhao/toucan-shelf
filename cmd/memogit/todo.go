package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/usememos/memos/internal/memogit"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// todoCmd reaches the user's todos in the app's plan with the checkout's own token, so any agent working in a
// checkout can hand the user something only they can do, and later learn what became of it. It never changes a
// todo's status: that is the user's, in the app.
func todoCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "todo",
		Short: "List, add and look up the user's todos in the app's plan (agents: ask the user before adding)",
		Long: `List, add and look up the user's todos in the app's plan.

An agent adds a todo only for something the user alone can do, and only after
the user agreed (see the manual's "用户待办" section). Check "memogit todo list"
first so the same thing is not added twice. Record the printed name
(planner/todos/<id>) on the source document's item; "memogit todo changes" and
"memogit todo get" later tell what became of it. The status is the user's: done,
cancelled or postponed in the app, never here.

Every subcommand takes --json for the full records.`,
	}
	cmd.AddCommand(todoListCmd(), todoAddCmd(), todoGetCmd(), todoChangesCmd())
	return cmd
}

func todoClient() (*memogit.Client, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return nil, err
	}
	root, err := memogit.FindRoot(cwd)
	if err != nil {
		return nil, err
	}
	cfg, err := memogit.LoadConfig(root)
	if err != nil {
		return nil, err
	}
	return memogit.NewClient(cfg), nil
}

func todoListCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List the open todos (check for the same thing before adding one)",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			client, err := todoClient()
			if err != nil {
				return err
			}
			todos, err := client.ListOpenTodos(cmd.Context())
			if err != nil {
				return err
			}
			if asJSON {
				return printJSON(cmd.OutOrStdout(), map[string]any{"todos": todos})
			}
			for _, todo := range todos {
				printTodoLine(cmd.OutOrStdout(), todo)
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "print the full records as JSON")
	return cmd
}

func todoAddCmd() *cobra.Command {
	var date, note string
	var docs []string
	var important, asJSON bool
	cmd := &cobra.Command{
		Use:   `add "<title>"`,
		Short: "Add a todo for the user (only after they agreed); prints its name planner/todos/<id>",
		Long: `Add a todo for the user, marked as made by an agent; prints its name.

The title is one action, without reasons or dates. --date is the day to start
on, even far ahead; a deadline goes in --note, with the reason and where it came
from. The note takes basic Markdown, so use a list or paragraphs when it runs to
several lines. --doc links a document of this checkout by its file path, and can
be repeated.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			title := strings.TrimSpace(args[0])
			if title == "" {
				return fmt.Errorf("the title is empty")
			}
			todo := &v1pb.Todo{Title: title, Date: date, Important: important, Note: note}
			for _, path := range docs {
				memo, err := memogit.DocMemoName(path)
				if err != nil {
					return err
				}
				todo.Memos = append(todo.Memos, memo)
			}
			client, err := todoClient()
			if err != nil {
				return err
			}
			created, err := client.CreateTodo(cmd.Context(), todo, time.Now().Format("2006-01-02"))
			if err != nil {
				return err
			}
			if asJSON {
				return printJSON(cmd.OutOrStdout(), created)
			}
			fmt.Fprintln(cmd.OutOrStdout(), created.Name)
			return nil
		},
	}
	cmd.Flags().StringVar(&date, "date", "", "the day to start on, YYYY-MM-DD (empty: no date)")
	cmd.Flags().StringVar(&note, "note", "", "deadline, reason and source; basic Markdown")
	cmd.Flags().StringArrayVar(&docs, "doc", nil, "a checked-out document file to link (repeatable)")
	cmd.Flags().BoolVar(&important, "important", false, "mark it important: the consequence is irreversible or costly")
	cmd.Flags().BoolVar(&asJSON, "json", false, "print the created record as JSON")
	return cmd
}

func todoGetCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "get <id | planner/todos/id>",
		Short: "Show one todo; a deleted one is reported as not found",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client, err := todoClient()
			if err != nil {
				return err
			}
			todo, err := client.GetTodo(cmd.Context(), args[0])
			if err != nil {
				return err
			}
			if asJSON {
				return printJSON(cmd.OutOrStdout(), todo)
			}
			printTodoLine(cmd.OutOrStdout(), todo)
			return nil
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "print the full record as JSON")
	return cmd
}

func todoChangesCmd() *cobra.Command {
	var since string
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "changes --since <time>",
		Short: "Todos created or changed since a time (done and cancelled too), and the ones deleted",
		Long: `Todos created or changed since a time, done and cancelled ones too, and the
ones deleted since then. --since is RFC 3339 (2026-10-31T09:00:00Z) or a date
(YYYY-MM-DD, from its start in local time). The last line (or "nextSince" in
--json) is the --since for the next call; a change in that very second comes
again, so de-duplicate by name.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			from, err := parseSince(since)
			if err != nil {
				return err
			}
			client, err := todoClient()
			if err != nil {
				return err
			}
			changes, err := client.ListTodoChanges(cmd.Context(), from)
			if err != nil {
				return err
			}
			next := changes.NextUpdatedSince.AsTime().Format(time.RFC3339)
			if asJSON {
				return printJSON(cmd.OutOrStdout(), map[string]any{"todos": changes.Todos, "deletedTodos": changes.DeletedTodos, "nextSince": next})
			}
			out := cmd.OutOrStdout()
			for _, todo := range changes.Todos {
				printTodoLine(out, todo)
			}
			for _, deleted := range changes.DeletedTodos {
				fmt.Fprintf(out, "%s\tDELETED\t%s\n", deleted.Name, deleted.DeleteTime.AsTime().Local().Format("2006-01-02 15:04"))
			}
			fmt.Fprintf(out, "next --since %s\n", next)
			return nil
		},
	}
	cmd.Flags().StringVar(&since, "since", "", "RFC 3339 time or YYYY-MM-DD (required)")
	cmd.Flags().BoolVar(&asJSON, "json", false, "print the full records as JSON")
	_ = cmd.MarkFlagRequired("since")
	return cmd
}

func parseSince(value string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, value); err == nil {
		return t, nil
	}
	if t, err := time.ParseInLocation("2006-01-02", value, time.Local); err == nil {
		return t, nil
	}
	return time.Time{}, fmt.Errorf("--since %q is neither RFC 3339 nor YYYY-MM-DD", value)
}

// printTodoLine prints one todo as name, status, date and title, tab-separated.
func printTodoLine(out io.Writer, todo *v1pb.Todo) {
	date := todo.Date
	if date == "" {
		date = "-"
	}
	fmt.Fprintf(out, "%s\t%s\t%s\t%s\n", todo.Name, todo.Status, date, todo.Title)
}

// printJSON prints protobuf messages with their API field names, inside plain JSON maps where needed.
func printJSON(out io.Writer, value any) error {
	encoded, err := json.MarshalIndent(protoJSONValue(value), "", "  ")
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(out, string(encoded))
	return err
}

func protoJSONValue(value any) any {
	switch v := value.(type) {
	case proto.Message:
		raw, _ := protojson.Marshal(v)
		return json.RawMessage(raw)
	case map[string]any:
		out := map[string]any{}
		for key, item := range v {
			out[key] = protoJSONValue(item)
		}
		return out
	case []*v1pb.Todo:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = protoJSONValue(item)
		}
		return out
	case []*v1pb.DeletedTodo:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = protoJSONValue(item)
		}
		return out
	default:
		return v
	}
}
