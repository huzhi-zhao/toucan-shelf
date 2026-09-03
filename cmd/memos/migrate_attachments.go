package main

import (
	"context"
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/usememos/memos/internal/storage/attachmentmigrate"
	"github.com/usememos/memos/store"
	"github.com/usememos/memos/store/db"
)

var migrateAttachmentsCmd = &cobra.Command{
	Use:   "migrate-attachments",
	Short: "Move S3 attachment objects to the keys the current filepath template produces",
	Long: `Move S3 attachment objects to the keys the current filepath template produces.

Use it after changing the bucket or root prefix, and to file attachments uploaded
before per-knowledge-base directories existed under their knowledge base.

Objects are copied, never moved: the source objects are left behind for you to
clean up once you have verified the result. Attachment URLs do not change — they
are derived from the attachment's uid, not from the object key.

For key-only attachment rows after a real bucket/provider move, pass the old
location once with --source-endpoint and/or --source-bucket. S3 credentials stay
centralized in the instance STORAGE setting and are never copied into attachment
rows.

Without --apply nothing is changed and nothing is written; you get a report of
what a run would do. Read it first.`,
	// A failure here is a runtime problem, not a usage problem; dumping the flag list after
	// the error only buries it.
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, _ []string) error {
		apply, err := cmd.Flags().GetBool("apply")
		if err != nil {
			return err
		}

		instanceProfile, err := newInstanceProfile()
		if err != nil {
			return err
		}
		ctx := context.Background()
		dbDriver, err := db.NewDBDriver(instanceProfile)
		if err != nil {
			return fmt.Errorf("failed to create db driver: %w", err)
		}
		defer dbDriver.Close()
		storeInstance := store.New(dbDriver, instanceProfile)
		// Deliberately no schema migration here: this command is an operational tool that
		// runs against an existing instance, and upgrading someone's schema as a side effect
		// of a read-only report would be a surprise. Start the server once instead.
		initialized, err := dbDriver.IsInitialized(ctx)
		if err != nil {
			return fmt.Errorf("failed to check database: %w", err)
		}
		if !initialized {
			return fmt.Errorf("database at %q is not initialized; start memos once first", instanceProfile.DSN)
		}

		sourceEndpoint, err := cmd.Flags().GetString("source-endpoint")
		if err != nil {
			return err
		}
		sourceBucket, err := cmd.Flags().GetString("source-bucket")
		if err != nil {
			return err
		}
		migrator := attachmentmigrate.New(storeInstance).WithSourceLocation(sourceEndpoint, sourceBucket)
		plan, err := migrator.Plan(ctx, apply)
		if err != nil {
			return err
		}
		plan.WritePlanReport(os.Stdout)

		_, pending, _ := plan.Counts()
		if pending == 0 && plan.EmbeddedConfigCount() == 0 {
			fmt.Println("\nNothing to migrate.")
			return nil
		}
		if !apply {
			fmt.Println("\nDry run — nothing was changed. Re-run with --apply to migrate.")
			return nil
		}

		fmt.Println("\nMigrating...")
		if err := migrator.Apply(ctx, plan); err != nil {
			return err
		}
		if failed := plan.WriteApplyReport(os.Stdout); failed > 0 {
			return fmt.Errorf("%d attachment(s) failed to migrate", failed)
		}
		return nil
	},
}

func init() {
	migrateAttachmentsCmd.Flags().Bool("apply", false, "actually copy the objects and repoint the database (default: report only)")
	migrateAttachmentsCmd.Flags().String("source-endpoint", "", "legacy source S3 endpoint for key-only attachment rows")
	migrateAttachmentsCmd.Flags().String("source-bucket", "", "legacy source S3 bucket for key-only attachment rows")
	rootCmd.AddCommand(migrateAttachmentsCmd)
}
