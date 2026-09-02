package s3

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/aws/aws-sdk-go-v2/aws"
	awshttp "github.com/aws/aws-sdk-go-v2/aws/transport/http"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go/middleware"
	smithyhttp "github.com/aws/smithy-go/transport/http"
	"github.com/pkg/errors"

	storepb "github.com/usememos/memos/proto/gen/store"
)

type Client struct {
	Client *s3.Client
	Bucket *string
}

func NewClient(ctx context.Context, s3Config *storepb.StorageS3Config) (*Client, error) {
	loadOptions := []func(*config.LoadOptions) error{
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(s3Config.AccessKeyId, s3Config.AccessKeySecret, "")),
		config.WithRegion(s3Config.Region),
		config.WithRequestChecksumCalculation(aws.RequestChecksumCalculationWhenRequired),
		config.WithResponseChecksumValidation(aws.ResponseChecksumValidationWhenRequired),
	}
	if s3Config.InsecureSkipTlsVerify {
		// Skip TLS certificate verification for endpoints using self-signed certificates.
		// This is opt-in and removes protection against man-in-the-middle attacks.
		httpClient := awshttp.NewBuildableClient().WithTransportOptions(func(tr *http.Transport) {
			tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} // #nosec G402 -- opt-in for self-signed S3 endpoints
		})
		loadOptions = append(loadOptions, config.WithHTTPClient(httpClient))
	}

	cfg, err := config.LoadDefaultConfig(ctx, loadOptions...)
	if err != nil {
		return nil, errors.Wrap(err, "failed to load s3 config")
	}

	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(s3Config.Endpoint)
		o.UsePathStyle = s3Config.UsePathStyle
		// Some CDNs/reverse proxies in front of S3-compatible endpoints (e.g. Cloudflare) rewrite
		// the Accept-Encoding header in transit. The SDK signs that header as part of SigV4, so the
		// provider ends up validating a signature computed over a header value that no longer
		// matches what it received, producing SignatureDoesNotMatch. Excluding it from signing
		// (and restoring the original value afterwards, since some providers still expect it on
		// the wire) avoids the mismatch without disabling the rest of the checksum/signing.
		ignoreSigningHeaders(o, []string{"Accept-Encoding"})
	})
	return &Client{
		Client: client,
		Bucket: aws.String(s3Config.Bucket),
	}, nil
}

type ignoredHeadersKey struct{}

func ignoreSigningHeaders(o *s3.Options, headers []string) {
	o.APIOptions = append(o.APIOptions, func(stack *middleware.Stack) error {
		if err := stack.Finalize.Insert(ignoreHeaders(headers), "Signing", middleware.Before); err != nil {
			return err
		}
		return stack.Finalize.Insert(restoreIgnored(), "Signing", middleware.After)
	})
}

func ignoreHeaders(headers []string) middleware.FinalizeMiddleware {
	return middleware.FinalizeMiddlewareFunc(
		"IgnoreHeaders",
		func(ctx context.Context, in middleware.FinalizeInput, next middleware.FinalizeHandler) (middleware.FinalizeOutput, middleware.Metadata, error) {
			req, ok := in.Request.(*smithyhttp.Request)
			if !ok {
				return middleware.FinalizeOutput{}, middleware.Metadata{}, fmt.Errorf("unexpected request type %T", in.Request)
			}
			ignored := make(map[string]string, len(headers))
			for _, h := range headers {
				ignored[h] = req.Header.Get(h)
				req.Header.Del(h)
			}
			ctx = middleware.WithStackValue(ctx, ignoredHeadersKey{}, ignored)
			return next.HandleFinalize(ctx, in)
		},
	)
}

func restoreIgnored() middleware.FinalizeMiddleware {
	return middleware.FinalizeMiddlewareFunc(
		"RestoreIgnored",
		func(ctx context.Context, in middleware.FinalizeInput, next middleware.FinalizeHandler) (middleware.FinalizeOutput, middleware.Metadata, error) {
			req, ok := in.Request.(*smithyhttp.Request)
			if !ok {
				return middleware.FinalizeOutput{}, middleware.Metadata{}, fmt.Errorf("unexpected request type %T", in.Request)
			}
			ignored, _ := middleware.GetStackValue(ctx, ignoredHeadersKey{}).(map[string]string)
			for k, v := range ignored {
				if v != "" {
					req.Header.Set(k, v)
				}
			}
			return next.HandleFinalize(ctx, in)
		},
	)
}

// UploadObject uploads an object to S3.
func (c *Client) UploadObject(ctx context.Context, key string, fileType string, content io.Reader) (string, error) {
	putInput := s3.PutObjectInput{
		Bucket:      c.Bucket,
		Key:         aws.String(key),
		ContentType: aws.String(fileType),
		Body:        content,
	}
	if _, err := c.Client.PutObject(ctx, &putInput); err != nil {
		return "", err
	}
	return key, nil
}

// GetObject retrieves an object from S3.
func (c *Client) GetObject(ctx context.Context, key string) ([]byte, error) {
	output, err := c.Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: c.Bucket,
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to download object")
	}
	defer output.Body.Close()
	data, err := io.ReadAll(output.Body)
	if err != nil {
		return nil, errors.Wrap(err, "failed to read object body")
	}
	return data, nil
}

// GetObjectStream retrieves an object from S3 as a stream.
func (c *Client) GetObjectStream(ctx context.Context, key string) (io.ReadCloser, error) {
	output, err := c.Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: c.Bucket,
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get object")
	}
	return output.Body, nil
}

// CopyObject asks S3 to copy an object into this client's bucket without the bytes passing
// through Toucan. sourceBucket/sourceKey must be reachable with the same credentials, which is
// why the caller decides whether this path applies (see canServerSideCopy): between two buckets
// of different accounts a server-side copy needs bucket policy on both sides that cannot be
// assumed, and the failure would only surface object by object.
func (c *Client) CopyObject(ctx context.Context, sourceBucket, sourceKey, targetKey string) error {
	// CopySource is a URL path, so a key containing spaces or non-ASCII (both ordinary in
	// attachment file names) has to be escaped or the provider looks up a different key.
	// EscapedPath escapes the characters that need it while leaving the separators alone --
	// url.PathEscape would turn every "/" into %2F and flatten the whole thing into one segment.
	source := (&url.URL{Path: sourceBucket + "/" + sourceKey}).EscapedPath()
	if _, err := c.Client.CopyObject(ctx, &s3.CopyObjectInput{
		Bucket:     c.Bucket,
		Key:        aws.String(targetKey),
		CopySource: aws.String(source),
	}); err != nil {
		return errors.Wrap(err, "failed to copy object")
	}
	return nil
}

// ObjectStat is what StatObject reports about an object: whether it is there, and how big.
type ObjectStat struct {
	Exists bool
	Size   int64
}

// StatObject reports the existence and size of an object without downloading it.
//
// It is the workhorse of the attachment storage migration: the precheck reads its probe back
// with it, the copier skips objects already present at the target with it (which is what makes
// a resumed migration idempotent), and reconciliation verifies every target object with it.
// A missing object is not an error -- it is the answer to the question.
func (c *Client) StatObject(ctx context.Context, key string) (ObjectStat, error) {
	output, err := c.Client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: c.Bucket,
		Key:    aws.String(key),
	})
	if err != nil {
		var notFound *types.NotFound
		if errors.As(err, &notFound) {
			return ObjectStat{}, nil
		}
		// Providers that do not map a missing key to NotFound still answer 404 on the wire.
		var respErr *awshttp.ResponseError
		if errors.As(err, &respErr) && respErr.HTTPStatusCode() == http.StatusNotFound {
			return ObjectStat{}, nil
		}
		return ObjectStat{}, errors.Wrap(err, "failed to stat object")
	}
	return ObjectStat{Exists: true, Size: aws.ToInt64(output.ContentLength)}, nil
}

// DeleteObject deletes an object in S3.
func (c *Client) DeleteObject(ctx context.Context, key string) error {
	_, err := c.Client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: c.Bucket,
		Key:    aws.String(key),
	})
	if err != nil {
		return errors.Wrap(err, "failed to delete object")
	}
	return nil
}
