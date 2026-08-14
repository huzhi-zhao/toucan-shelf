package test

import (
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	code := m.Run()
	TerminateContainers()
	os.Exit(code)
}
