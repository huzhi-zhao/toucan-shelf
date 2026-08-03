"""slugify_port.py 与平台 TS 实现的对拍测试。

跑法（在本目录下）：
    python3 -m pytest test_slugify_port.py -v
    # 或者不装 pytest：
    python3 test_slugify_port.py

对拍不是「照着 TS 再写一份 JS」——那样等于自己跟自己比。这里直接从
web/src/utils/markdown-manipulation.ts **原文**里切出 slugify / shortHash / headingSlug
三个函数体，剥掉 TS 类型标注后交给 node 执行。源实现一旦改动或改名，切片会失败并
报错，而不是悄悄比对一份过期的副本。

语料优先取源知识库里的全部真实标题（含章节编号、emoji、括号、中英混排），
再补一批边界用例。
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from slugify_port import HeadingIndex, heading_slug, slugify  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[4]
TS_SOURCE = REPO_ROOT / "web/src/utils/markdown-manipulation.ts"

DEFAULT_SOURCE_DIR = Path(
    os.environ.get(
        "KB_SOURCE_DIR",
        Path.home() / "Workspace/jimmy-pink/jimmy-zhz.github.io/AI-Knowledge-Base",
    )
)

EDGE_CASES = [
    "Hello World",
    "  leading and trailing  ",
    "2.2 简单线性回归 (Simple Linear Regression)",
    "📈 回归任务的评估指标",
    "🎯",  # 纯 emoji：必须走 h-<hash> 回退
    "！？。，",  # 纯标点：同上
    "snake_case_heading",
    "多个    空格",
    "连字符---折叠",
    "-首尾连字符-",
    "Ångström",  # NFC 归一化
    "MiXeD CaSe 中英 Mixed",
    "层归一化 Layer Normalization",
    "3.4 循环神经网络 RNN",
    "",
    " ",
    "$x^2 + y^2$",
    "C++ 与 C#",
    "a/b/c",
    "🇨🇳 星平面字符参与哈希",
]


def _extract_js_functions() -> str:
    """从 TS 源文件里切出三个纯函数，剥掉类型标注供 node 直接执行。"""
    src = TS_SOURCE.read_text(encoding="utf-8")
    chunks = []
    for name in ("slugify", "shortHash", "headingSlug"):
        pattern = re.compile(
            r"(?:export\s+)?function\s+" + name + r"\s*\([^)]*\)\s*:\s*string\s*\{",
        )
        m = pattern.search(src)
        assert m, (
            f"没能在 {TS_SOURCE} 里找到 function {name}(...): string —— "
            "源实现可能被改名或换了签名，对拍失效，必须先修这里再迁移。"
        )
        # 从 `{` 起做花括号配平，取出完整函数体
        start = m.end() - 1
        depth = 0
        end = None
        for i in range(start, len(src)):
            if src[i] == "{":
                depth += 1
            elif src[i] == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        assert end, f"function {name} 的花括号没配平"
        body = src[m.start() : end]
        body = body.replace("export ", "")
        body = re.sub(r"\)\s*:\s*string\s*\{", ") {", body)
        body = re.sub(r"\b(\w+)\s*:\s*string\b", r"\1", body)
        body = re.sub(r"\blet\s+(\w+)\s*=\s*0;", r"let \1 = 0;", body)
        chunks.append(body)
    return "\n".join(chunks)


def _reference_slugs(texts: list[str]) -> list[str]:
    """用 node 跑 TS 原文里的 headingSlug，返回参考结果。"""
    node = shutil.which("node")
    if not node:
        raise RuntimeError("对拍需要 node，未在 PATH 中找到")
    script = (
        _extract_js_functions()
        + "\nconst input = JSON.parse(process.argv[1]);"
        + "\nprocess.stdout.write(JSON.stringify(input.map(headingSlug)));"
    )
    proc = subprocess.run(
        [node, "-e", script, json.dumps(texts)],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"node 执行失败：{proc.stderr}")
    return json.loads(proc.stdout)


def _corpus() -> list[str]:
    """真实语料：源库里所有 markdown 标题 + 裸 HTML 标题。"""
    texts: list[str] = []
    if DEFAULT_SOURCE_DIR.is_dir():
        atx = re.compile(r"^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$")
        html_h = re.compile(r"<h([1-6])\b[^>]*>(.*?)</h\1>", re.S | re.I)
        for path in sorted(DEFAULT_SOURCE_DIR.rglob("*.md")):
            if ".obsidian" in path.parts:
                continue
            content = path.read_text(encoding="utf-8", errors="replace")
            for line in content.splitlines():
                m = atx.match(line)
                if m and m.group(1):
                    texts.append(m.group(1))
            for m in html_h.finditer(content):
                inner = re.sub(r"<[^>]+>", "", m.group(2))
                if inner.strip():
                    texts.append(inner.strip())
    return texts


def test_slug_matches_platform_implementation():
    texts = EDGE_CASES + _corpus()
    assert len(texts) > len(EDGE_CASES), (
        f"没有从 {DEFAULT_SOURCE_DIR} 读到任何标题语料。"
        "设 KB_SOURCE_DIR 指向源知识库后重跑——只用边界用例对拍是不够的。"
    )
    expected = _reference_slugs(texts)
    mismatches = [
        (t, e, heading_slug(t)) for t, e in zip(texts, expected) if heading_slug(t) != e
    ]
    assert not mismatches, "与平台实现不一致：\n" + "\n".join(
        f"  {t!r}: TS={e!r} PY={p!r}" for t, e, p in mismatches[:20]
    )


def test_duplicate_headings_get_numbered_suffix():
    """复刻 rehype-heading-id 的重名计数：第 n 次出现追加 -n。"""
    index = HeadingIndex()
    assert index.add("模型评估") == "模型评估"
    assert index.add("模型评估") == "模型评估-1"
    assert index.add("模型评估") == "模型评估-2"
    assert index.add("其他") == "其他"


def test_empty_slug_falls_back_to_hash():
    slug = heading_slug("🎯")
    assert slug.startswith("h-") and len(slug) > 2
    assert slugify("🎯") == ""


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
            print(f"PASS {name}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"FAIL {name}\n  {exc}")
    sys.exit(1 if failures else 0)
