package attachmentmigrate

import (
	"fmt"
	"io"
	"sort"

	"github.com/usememos/memos/internal/storage/attachmentpath"
)

// WritePlanReport prints what the plan found. This is the whole output of a dry run, and the
// thing to read before deciding to apply anything.
func (p *Plan) WritePlanReport(w io.Writer) {
	inPlace, pending, skipped := p.Counts()
	embeddedConfigs := p.EmbeddedConfigCount()
	fmt.Fprintf(w, "Filepath template: %s\n", p.Template)
	fmt.Fprintf(w, "Target: bucket %s at %s\n", p.TargetBucket, p.TargetEndpoint)
	fmt.Fprintf(w, "\nS3 attachments: %d total — %d already in place, %d to migrate, %d cannot be processed\n",
		len(p.Items), inPlace, pending, skipped)
	if embeddedConfigs > 0 {
		fmt.Fprintf(w, "Legacy per-attachment S3 configs: %d to remove on successful apply\n", embeddedConfigs)
	}

	if pending > 0 {
		fmt.Fprintf(w, "\nTo migrate, by knowledge base:\n")
		byWorkspace := map[string][]*Item{}
		for _, item := range p.Items {
			if item.Status == StatusPending {
				byWorkspace[item.WorkspaceSlug] = append(byWorkspace[item.WorkspaceSlug], item)
			}
		}
		for _, slug := range sortedKeys(byWorkspace) {
			items := byWorkspace[slug]
			label := slug
			if slug == attachmentpath.UnassignedWorkspaceSlug {
				label = slug + "  (attachments not attached to any document)"
			}
			if items[0].SlugBackfilled {
				label += "  (slug backfilled — this knowledge base had none)"
			}
			fmt.Fprintf(w, "  %s: %d\n", label, len(items))
			for _, item := range items {
				fmt.Fprintf(w, "    #%d %s\n      %s\n      -> %s\n", item.AttachmentID, item.Filename, item.SourceKey, item.TargetKey)
			}
		}
	}

	if skipped > 0 {
		fmt.Fprintf(w, "\nCannot be processed:\n")
		for _, item := range p.Items {
			if item.Status == StatusSkipped {
				fmt.Fprintf(w, "  #%d %s: %s\n", item.AttachmentID, item.Filename, item.Reason)
			}
		}
	}
}

// WriteApplyReport prints what applying the plan actually did, and reports whether anything failed.
//
// A missing source object is counted and listed apart from a failure on purpose. They look the
// same from the migration's side -- an object it wanted and did not get -- but they need
// opposite reactions: a failure is worth retrying or investigating, while a missing source is a
// hole that was already there and that no re-run will fill. Lumping them together would leave a
// wall of red where most of it is nothing new.
func (p *Plan) WriteApplyReport(w io.Writer) (failed int) {
	copied, reused, sourceMissing, configsRemoved := 0, 0, 0, 0
	for _, item := range p.Items {
		switch item.Outcome {
		case OutcomeCopied:
			copied++
		case OutcomeReused:
			reused++
		case OutcomeSourceMissing:
			sourceMissing++
		case OutcomeConfigRemoved:
			configsRemoved++
		case OutcomeFailed:
			failed++
		}
	}
	fmt.Fprintf(w, "\nMigrated: %d copied, %d already at the target key, %d source object missing, %d failed\n",
		copied, reused, sourceMissing, failed)
	if configsRemoved > 0 {
		fmt.Fprintf(w, "Legacy per-attachment S3 configs removed: %d\n", configsRemoved)
	}
	if sourceMissing > 0 {
		fmt.Fprintf(w, "\nSource object missing (already broken before this migration — the row points at\nan object that is not in the source bucket; re-running will not change this):\n")
		for _, item := range p.Items {
			if item.Outcome == OutcomeSourceMissing {
				fmt.Fprintf(w, "  #%d %s: %s\n", item.AttachmentID, item.Filename, item.SourceKey)
			}
		}
	}
	if failed > 0 {
		fmt.Fprintf(w, "\nFailures (left untouched, safe to re-run after fixing):\n")
		for _, item := range p.Items {
			if item.Outcome == OutcomeFailed {
				fmt.Fprintf(w, "  #%d %s: %s\n", item.AttachmentID, item.Filename, item.Error)
			}
		}
	}
	fmt.Fprintf(w, "\nThe source objects were not deleted. Clean them up yourself once you have\nverified the attachments still open — an S3 lifecycle rule, or deleting the old\nbucket/prefix by hand.\n")
	return failed
}

func sortedKeys(m map[string][]*Item) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
