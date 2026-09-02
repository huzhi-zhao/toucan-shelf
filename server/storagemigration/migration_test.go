package storagemigration

import (
	"testing"

	"github.com/stretchr/testify/require"

	storepb "github.com/usememos/memos/proto/gen/store"
)

func targetConfig(endpoint, bucket, rootPrefix string) *storepb.StorageS3Config {
	return &storepb.StorageS3Config{
		Endpoint:        endpoint,
		Bucket:          bucket,
		RootPrefix:      rootPrefix,
		Region:          "us-east-1",
		AccessKeyId:     "key",
		AccessKeySecret: "secret",
	}
}

func TestCanServerSideCopy(t *testing.T) {
	current := targetConfig("https://s3.example.com", "kb", "assets")

	// Only the location differs: same account, same endpoint, so S3 can copy it itself.
	require.True(t, CanServerSideCopy(current, targetConfig("https://s3.example.com", "kb-new", "shelf")))

	// A different endpoint is a different storage; nothing can be assumed about copying between.
	require.False(t, CanServerSideCopy(current, targetConfig("https://minio.internal", "kb-new", "assets")))

	// Same endpoint, different credentials: very likely a different account or tenant, where a
	// server-side copy needs bucket policy on both sides that we cannot assume exists.
	otherAccount := targetConfig("https://s3.example.com", "kb-new", "assets")
	otherAccount.AccessKeyId = "other"
	require.False(t, CanServerSideCopy(current, otherAccount))

	otherRegion := targetConfig("https://s3.example.com", "kb-new", "assets")
	otherRegion.Region = "eu-west-1"
	require.False(t, CanServerSideCopy(current, otherRegion))

	require.False(t, CanServerSideCopy(nil, current))
}
