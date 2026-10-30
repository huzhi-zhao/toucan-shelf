package v1

import (
	"testing"

	"github.com/stretchr/testify/assert"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

// The bullet list style survives the round trip, unset stays unset, and a value this server does not know yet
// is kept rather than dropped, so a newer client's choice is not lost.
func TestDocConfigBulletListStyleRoundTrip(t *testing.T) {
	for _, style := range []v1pb.DocConfig_BulletListStyle{v1pb.DocConfig_PLAIN, v1pb.DocConfig_CARDS, v1pb.DocConfig_BulletListStyle(9)} {
		got := convertDocConfigFromStore(convertDocConfigToStore(&v1pb.DocConfig{BulletListStyle: &style}))
		assert.Equal(t, style, got.GetBulletListStyle())
	}
	unset := convertDocConfigFromStore(convertDocConfigToStore(&v1pb.DocConfig{}))
	assert.Nil(t, unset.BulletListStyle)
}
