package s3

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net/http"

	"github.com/aws/aws-sdk-go-v2/aws"
	awshttp "github.com/aws/aws-sdk-go-v2/aws/transport/http"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
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
