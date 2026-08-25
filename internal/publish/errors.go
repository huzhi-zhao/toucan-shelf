package publish

import "github.com/pkg/errors"

var (
	// ErrSlugEmpty is returned when a manually set slug is blank.
	ErrSlugEmpty = errors.New("slug must not be empty")
	// ErrSlugReserved is returned when a manually set slug would take a path the
	// site keeps for itself.
	ErrSlugReserved = errors.New("slug is reserved by the site")
	// ErrSlugInvalidChars is returned when a manually set slug contains
	// characters that are not allowed in a slug.
	ErrSlugInvalidChars = errors.New("slug may only contain lowercase letters, digits and hyphens")
)
