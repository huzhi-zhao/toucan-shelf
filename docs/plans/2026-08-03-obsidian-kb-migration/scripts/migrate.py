#!/usr/bin/env python3
"""Obsidian 知识库 -> ToucanShelf 一次性迁移脚本。

方案见同目录的 ../02-migration.md。四个子命令，每一个都可以独立重跑：

    plan     只读盘点：产出转换计划与风险清单，不发任何写请求
    stage    产出第一趟 push 用的文档树（正文未转换，用来换取 memo uid）
    attach   读回 uid 映射 -> 上传附件 -> 回写正文，产出最终文档树
    report   汇总人工复核报告

脚本**不代跑 memogit**。每一步的产物都落在 --work-dir 里，由使用者自己核对后
拷进 checkout 再 push。源库全程只读。
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import os
import re
import shutil
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from slugify_port import HeadingIndex  # noqa: E402

# --------------------------------------------------------------------------------------
# 配置
# --------------------------------------------------------------------------------------

DEFAULT_SOURCE = Path.home() / "Workspace/jimmy-pink/jimmy-zhz.github.io/AI-Knowledge-Base"
DEFAULT_WORK = Path.home() / "Workspace/kb-migration-work"

# 不迁入的文件（相对源库根，POSIX 分隔符）。理由见 02-migration.md §3.5。
EXCLUDED_FILES = {
    "index.md": "Quartz 站点门面页：整段 landing HTML + 外链字体，是「站点」不是「知识」",
    "home.md": "同上",
    "未命名.md": "空文件",
    "resources/Card Demo.md": "Quartz 卡片组件的样式演示页，41 个 class div，剥壳后只剩残渣",
}

# 整个目录都不进内容树
EXCLUDED_DIRS = {".obsidian", ".git", ".trash", "node_modules", "images", "resources"}

# 这些扩展名的文件即便在内容目录里也不算文档（走附件通道或直接忽略）
DOC_SUFFIXES = {".md"}

# .canvas 不迁移，留在源库里归档
ARCHIVE_SUFFIXES = {".canvas"}

BLOCK_TAGS = {
    "div", "section", "article", "header", "footer", "nav", "aside", "p",
    "ul", "ol", "li", "table", "tr", "blockquote", "figure", "figcaption",
    "h1", "h2", "h3", "h4", "h5", "h6",
}
VOID_TAGS = {"br", "hr", "img", "input", "link", "meta", "source", "col", "area"}


# --------------------------------------------------------------------------------------
# 通用：保护区（代码块 / 行内代码 / 数学公式 / HTML 注释）
# --------------------------------------------------------------------------------------

FENCE_RE = re.compile(r"^(?P<indent> {0,3})(?P<fence>```+|~~~+)[^\n]*\n(?P<body>.*?)(?:^\s{0,3}(?P=fence)[^\n]*$|\Z)", re.S | re.M)
INLINE_CODE_RE = re.compile(r"(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)", re.S)
BLOCK_MATH_RE = re.compile(r"\$\$.*?\$\$", re.S)
INLINE_MATH_RE = re.compile(r"(?<!\$)\$(?!\s)([^\n$]+?)(?<!\s)\$(?!\$)")
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)


def protected_spans(text: str) -> list[tuple[int, int]]:
    """返回不应被任何转换触碰的区间（左闭右开），已合并、已排序。

    `[[ '列1','列2' ]]` 这种出现在 Python 代码块里的方括号会被 wikilink 正则误伤，
    所以每一处替换都必须先问一句「这个位置在保护区里吗」。
    """
    spans: list[tuple[int, int]] = []
    for regex in (FENCE_RE, HTML_COMMENT_RE, BLOCK_MATH_RE, INLINE_CODE_RE, INLINE_MATH_RE):
        for m in regex.finditer(text):
            spans.append((m.start(), m.end()))
    if not spans:
        return []
    spans.sort()
    merged = [spans[0]]
    for start, end in spans[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def in_spans(pos: int, spans: list[tuple[int, int]]) -> bool:
    for start, end in spans:
        if start <= pos < end:
            return True
        if start > pos:
            break
    return False


def sub_outside_protected(
    regex: re.Pattern[str], text: str, repl: Callable[[re.Match[str]], str]
) -> str:
    """只替换落在保护区之外的匹配。"""
    spans = protected_spans(text)
    out: list[str] = []
    cursor = 0
    for m in regex.finditer(text):
        if in_spans(m.start(), spans):
            continue
        out.append(text[cursor : m.start()])
        out.append(repl(m))
        cursor = m.end()
    out.append(text[cursor:])
    return "".join(out)


def blank_protected(text: str) -> str:
    """把保护区内容替换成等长的空格（保留换行），用于扫描标题时排除代码块。"""
    chars = list(text)
    for start, end in protected_spans(text):
        for i in range(start, end):
            if chars[i] != "\n":
                chars[i] = " "
    return "".join(chars)


# --------------------------------------------------------------------------------------
# 解析
# --------------------------------------------------------------------------------------

ATX_RE = re.compile(r"^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$", re.M)
HTML_HEADING_RE = re.compile(r"<h([1-6])\b[^>]*>(.*?)</h\1>", re.S | re.I)
EMBED_RE = re.compile(r"!\[\[([^\]\n]+)\]\]")
WIKILINK_RE = re.compile(r"(?<!!)\[\[([^\]\n]+)\]\]")
TAG_RE = re.compile(r"<(/?)([a-zA-Z][-\w]*)((?:\"[^\"]*\"|'[^']*'|[^>\"'])*?)(/?)>")

INLINE_MD_STRIPPERS = [
    (re.compile(r"!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]"), r"\1"),
    (re.compile(r"\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]"), lambda m: m.group(3) or m.group(2) or m.group(1)),
    (re.compile(r"!\[([^\]]*)\]\([^)]*\)"), r"\1"),
    (re.compile(r"\[([^\]]*)\]\([^)]*\)"), r"\1"),
    (re.compile(r"`+([^`]*)`+"), r"\1"),
    (re.compile(r"(\*\*|__|\*|_|~~)"), ""),
    (re.compile(r"<[^>]+>"), ""),
]


def heading_text(raw: str) -> str:
    """把标题行的 markdown 内联语法剥成纯文本 —— 对应 TS 侧的 getNodeText()。"""
    text = raw
    for regex, repl in INLINE_MD_STRIPPERS:
        text = regex.sub(repl, text)
    return text.strip()


@dataclass
class Heading:
    text: str
    level: int
    offset: int
    anchor: str = ""


def extract_headings(content: str) -> list[Heading]:
    """按文档顺序取出 markdown ATX 标题，并按平台规则分配锚点。

    **只认 `#` 标题，裸 HTML 的 `<h1 style=...>` 不参与。**
    平台侧的 rehype-heading-id 其实会给 hast 里的 h1-h6 一律赋 id、包括 HTML 写的那些，
    所以严格模拟的话应该把它们算进来。这里有意不这么做：本库几乎每篇的大标题都写成
    `<h1 style=...>`，把它们纳入锚点体系等于把「标题」这件事永久绑在一段样式 HTML 上。
    迁移后的正确做法是把那些 `<h1>` 改回 `# 标题`（作者后续手动处理），到那时锚点自然
    就对了。现在指向 HTML 大标题的少量链接会降级为文档级链接，并进复核报告。
    """
    scan = blank_protected(content)
    found: list[Heading] = []
    for m in ATX_RE.finditer(scan):
        text = heading_text(content[m.start(2) : m.end(2)])
        if text:
            found.append(Heading(text, len(m.group(1)), m.start()))
    found.sort(key=lambda h: h.offset)

    index = HeadingIndex()
    for h in found:
        h.anchor = index.add(h.text)
    return found


def normalize_for_match(text: str) -> str:
    """归一化到「只剩字母数字、去掉章节编号」的形态，用于锚点模糊匹配。

    源库里大量标题后来加了章节编号（`### 2.2 简单线性回归 (...)`），而链接还指向
    旧的无编号写法。归一化让这类链接能救回来。
    """
    s = unicodedata.normalize("NFC", text).lower()
    s = "".join(ch for ch in s if unicodedata.category(ch)[0] in ("L", "N"))
    s = re.sub(r"^[0-9]+", "", s)
    return s


@dataclass
class Doc:
    rel: str  # 相对源库根，POSIX
    path: Path
    content: str
    headings: list[Heading] = field(default_factory=list)

    @property
    def stem(self) -> str:
        return Path(self.rel).stem


# --------------------------------------------------------------------------------------
# 源库扫描
# --------------------------------------------------------------------------------------


def load_docs(source: Path) -> tuple[list[Doc], list[tuple[str, str]]]:
    """返回 (要迁入的文档, [(被排除的相对路径, 理由)])。"""
    docs: list[Doc] = []
    excluded: list[tuple[str, str]] = []

    for path in sorted(source.rglob("*")):
        if not path.is_file() or path.name == ".DS_Store":
            continue
        rel = path.relative_to(source).as_posix()
        rel_parts = path.relative_to(source).parts

        if any(part.startswith(".") for part in rel_parts):
            continue
        if any(part in EXCLUDED_DIRS for part in rel_parts[:-1]):
            reason = f"位于排除目录 {rel_parts[0]}/（资源文件走附件通道，绝不进内容树）"
            if path.suffix.lower() in DOC_SUFFIXES:
                excluded.append((rel, reason))
            continue
        if path.suffix.lower() in ARCHIVE_SUFFIXES:
            excluded.append((rel, "Obsidian 白板格式，无对应文档类型；留在源库归档，不迁移"))
            continue
        if rel in EXCLUDED_FILES:
            excluded.append((rel, EXCLUDED_FILES[rel]))
            continue
        if path.suffix.lower() not in DOC_SUFFIXES:
            excluded.append((rel, f"非文档扩展名 {path.suffix}，不进内容树"))
            continue

        content = path.read_text(encoding="utf-8")
        doc = Doc(rel=rel, path=path, content=content)
        doc.headings = extract_headings(content)
        docs.append(doc)

    return docs, excluded


def build_asset_index(source: Path) -> tuple[dict[str, list[Path]], list[Path]]:
    """basename（含扩展名）-> 文件列表。重名会被显式暴露而不是随便挑一个。"""
    index: dict[str, list[Path]] = {}
    assets: list[Path] = []
    for path in sorted(source.rglob("*")):
        if not path.is_file() or path.name == ".DS_Store":
            continue
        if any(part.startswith(".") for part in path.relative_to(source).parts):
            continue
        if path.suffix.lower() in DOC_SUFFIXES or path.suffix.lower() in ARCHIVE_SUFFIXES:
            continue
        assets.append(path)
        index.setdefault(path.name, []).append(path)
    return index, assets


# --------------------------------------------------------------------------------------
# 引用解析
# --------------------------------------------------------------------------------------


@dataclass
class Issue:
    kind: str
    doc: str
    detail: str


@dataclass
class EmbedRef:
    raw: str
    target: str  # `![[x.png|300]]` 里的 x.png
    resolved: Path | None
    note: str = ""


@dataclass
class LinkRef:
    raw: str
    doc_target: str  # 空串表示同文档
    anchor: str
    alias: str


def parse_embeds(doc: Doc, assets: dict[str, list[Path]]) -> tuple[list[EmbedRef], list[Issue]]:
    refs: list[EmbedRef] = []
    issues: list[Issue] = []
    spans = protected_spans(doc.content)
    for m in EMBED_RE.finditer(doc.content):
        if in_spans(m.start(), spans):
            continue
        inner = m.group(1)
        target = inner.split("|")[0].strip()  # 丢掉 Obsidian 的尺寸参数
        name = target.split("/")[-1]
        candidates = assets.get(name, [])
        if not candidates:
            refs.append(EmbedRef(m.group(0), target, None, "找不到对应文件"))
            issues.append(Issue("embed-unresolved", doc.rel, f"{m.group(0)} -> 库内找不到 {name}"))
        elif len(candidates) > 1:
            refs.append(EmbedRef(m.group(0), target, None, "basename 重名，无法确定"))
            issues.append(
                Issue(
                    "embed-ambiguous",
                    doc.rel,
                    f"{m.group(0)} -> 命中多个文件：" + ", ".join(str(c) for c in candidates),
                )
            )
        else:
            note = "带尺寸参数，参数丢弃" if "|" in inner else ""
            if "/" in target:
                note = (note + " / " if note else "") + "写成路径形式，按 basename 解析"
            refs.append(EmbedRef(m.group(0), target, candidates[0], note))
    return refs, issues


def parse_links(doc: Doc) -> list[LinkRef]:
    refs: list[LinkRef] = []
    spans = protected_spans(doc.content)
    for m in WIKILINK_RE.finditer(doc.content):
        if in_spans(m.start(), spans):
            continue
        inner = m.group(1)
        body, _, alias = inner.partition("|")
        target, _, anchor = body.partition("#")
        refs.append(LinkRef(m.group(0), target.strip(), anchor.strip(), alias.strip()))
    return refs


# 锚点里允许一层圆括号：源库里有 `](#Vision-Transformers(ViT))` 这种写法，
# 用 `[^)]+` 会在第一个 `)` 处截断，改写后留下一个多余的 `)`。
MD_ANCHOR_LINK_RE = re.compile(r"\]\(#((?:[^()\s]|\([^()\s]*\))+)\)")


def check_existing_anchors(doc: Doc) -> list[Issue]:
    """校验源库里已有的 `](#anchor)` 链接在平台的 slug 规则下是否仍然指得中。"""
    valid = {h.anchor for h in doc.headings}
    spans = protected_spans(doc.content)
    issues: list[Issue] = []
    for m in MD_ANCHOR_LINK_RE.finditer(doc.content):
        if in_spans(m.start(), spans):
            continue
        anchor = urllib.parse.unquote(m.group(1))
        if anchor in valid:
            continue
        fixed, how = resolve_anchor(anchor, doc.headings)
        if fixed:
            issues.append(
                Issue("existing-anchor-stale", doc.rel, f"](#{anchor}) 指不中，最接近的是 #{fixed}（{how}）")
            )
        else:
            issues.append(Issue("existing-anchor-broken", doc.rel, f"](#{anchor}) 在本篇找不到对应标题"))
    return issues


def resolve_anchor(anchor: str, headings: list[Heading]) -> tuple[str | None, str]:
    """按「精确 -> 归一化 -> 归一化前缀」三级解析，返回 (锚点 id, 匹配方式)。"""
    if not anchor:
        return None, "empty"
    if anchor.startswith("^"):
        return None, "block-ref"  # Obsidian 块引用，平台无对应概念

    for h in headings:
        if h.text == anchor:
            return h.anchor, "exact"

    want = normalize_for_match(anchor)
    if not want:
        return None, "normalized-empty"

    hits = [h for h in headings if normalize_for_match(h.text) == want]
    if len(hits) == 1:
        return hits[0].anchor, "normalized"
    if len(hits) > 1:
        return hits[0].anchor, "normalized-ambiguous"

    hits = [h for h in headings if normalize_for_match(h.text).startswith(want)]
    if len(hits) == 1:
        return hits[0].anchor, "prefix"
    if len(hits) > 1:
        return None, "prefix-ambiguous"

    # 反向：链接文字比标题长（标题后来被截短）
    hits = [h for h in headings if want.startswith(normalize_for_match(h.text)) and normalize_for_match(h.text)]
    if len(hits) == 1:
        return hits[0].anchor, "reverse-prefix"

    return None, "unmatched"


# --------------------------------------------------------------------------------------
# URL 生成
# --------------------------------------------------------------------------------------


def encode_attachment_filename(filename: str) -> str:
    """复刻 web/src/utils/attachment.ts 的 encodeAttachmentFilename。

    括号必须转义：未转义的 `)` 会提前终止 markdown 链接语法，而本库文件名里
    括号很常见。
    """
    # JS 的 encodeURIComponent 不转义 !'()*~，其余按 UTF-8 百分号编码
    encoded = urllib.parse.quote(filename, safe="!'()*~-_.")
    return encoded.replace("(", "%28").replace(")", "%29")


def attachment_url(attachment_name: str, filename: str) -> str:
    """根相对 URL。绝不能带协议和域名 —— 渲染器的 sanitize schema 只放行 https，
    绝对的 http:// URL 在本地开发或纯 HTTP 自建部署下会被整个剥掉。"""
    return f"/file/{attachment_name}/{encode_attachment_filename(filename)}"


def memo_url(uid: str, anchor: str = "") -> str:
    return f"/memos/{uid}" + (f"#{anchor}" if anchor else "")


# --------------------------------------------------------------------------------------
# HTML 剥壳
# --------------------------------------------------------------------------------------


def strip_class_html(content: str) -> tuple[str, list[str]]:
    """凡带 class= 的 HTML 标签，剥去标签外壳只留纯文本；返回 (新正文, 被剥片段)。

    只带内联 style 的标签**原样保留** —— 那批由计划 1 需求 A 负责渲染。
    """
    spans = protected_spans(content)
    removals: list[tuple[int, int, bool]] = []  # (start, end, 是否块级)
    stripped: list[str] = []
    stack: list[tuple[str, bool, int]] = []  # (标签名, 是否带 class, 开标签起点)

    for m in TAG_RE.finditer(content):
        if in_spans(m.start(), spans):
            continue
        closing, name, attrs, self_closing = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        has_class = re.search(r"\bclass\s*=", attrs) is not None
        is_block = name in BLOCK_TAGS

        if closing:
            for i in range(len(stack) - 1, -1, -1):
                if stack[i][0] == name:
                    _, opened_with_class, open_start = stack.pop(i)
                    del stack[i:]
                    if opened_with_class:
                        removals.append((m.start(), m.end(), is_block))
                        stripped.append(content[open_start : m.end()])
                    break
            continue

        if self_closing or name in VOID_TAGS:
            if has_class:
                removals.append((m.start(), m.end(), is_block))
                stripped.append(m.group(0))
            continue

        stack.append((name, has_class, m.start()))
        if has_class:
            removals.append((m.start(), m.end(), is_block))

    if not removals:
        return content, []

    removals.sort()
    out: list[str] = []
    cursor = 0
    for start, end, is_block in removals:
        out.append(content[cursor:start])
        if is_block:
            out.append("\n")
        cursor = end
    out.append(content[cursor:])
    result = "".join(out)

    # 剥掉块级标签会留下成片空行，收敛一下；代码块/公式在保护区内不受影响
    result = sub_outside_protected(re.compile(r"\n{3,}"), result, lambda _m: "\n\n")
    return result, stripped


# --------------------------------------------------------------------------------------
# API 客户端
# --------------------------------------------------------------------------------------


class ToucanClient:
    """走 Connect 的 JSON unary 调用（与 memogit 用的是同一套 handler）。"""

    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token

    def call(self, service: str, method: str, payload: dict) -> dict:
        url = f"{self.base_url}/{service}/{method}"
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}",
                "Connect-Protocol-Version": "1",
                # 目标站在 Cloudflare 后面，urllib 默认的 Python-urllib/x.y 会被
                # 浏览器完整性检查拒掉（HTTP 403, error code: 1010）。
                "User-Agent": "kb-migration/1.0",
            },
        )
        # 目标站在 Cloudflare 后面，观测到约 15% 的连接会在写请求体的中途被重置
        # （BrokenPipe / URLError），与请求大小无关。这是传输层抖动，重试即可；
        # 上层的确定性 attachment_id + get_attachment 兜住「其实已经建好了」的情形。
        last: Exception | None = None
        for attempt in range(5):
            if attempt:
                time.sleep(2**attempt)
            try:
                with urllib.request.urlopen(req, timeout=180) as resp:
                    body = resp.read()
                return json.loads(body) if body else {}
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", "replace")
                # 唯一约束冲突是确定性的（附件已存在），重试只会重复失败。
                retryable = exc.code in (429, 500, 502, 503, 504, 520, 521, 522, 523, 524)
                if "UNIQUE constraint" in detail:
                    retryable = False
                if retryable:
                    last = ApiError(exc.code, detail)
                    print(
                        f"  重试（HTTP {exc.code}，第 {attempt + 1} 次）：{detail[:500]}",
                        file=sys.stderr,
                    )
                    continue
                raise ApiError(exc.code, detail) from None
            except (urllib.error.URLError, OSError) as exc:
                last = exc
                print(f"  重试（{exc.__class__.__name__}，第 {attempt + 1} 次）", file=sys.stderr)
        raise ApiError(0, f"重试 5 次仍失败：{last}") from None

    def create_attachment(
        self, *, attachment_id: str, filename: str, mime: str, content: bytes, memo_name: str
    ) -> dict:
        return self.call(
            "memos.api.v1.AttachmentService",
            "CreateAttachment",
            {
                "attachmentId": attachment_id,
                "attachment": {
                    "filename": filename,
                    "type": mime,
                    "content": base64.b64encode(content).decode("ascii"),
                    "memo": memo_name,
                },
            },
        )

    def get_attachment(self, uid: str) -> dict:
        return self.call(
            "memos.api.v1.AttachmentService", "GetAttachment", {"name": f"attachments/{uid}"}
        )

    def upload_size_limit_bytes(self) -> int | None:
        """读实例的上传大小上限；读不到（多半是权限）就返回 None，由调用方降级。"""
        try:
            setting = self.call(
                "memos.api.v1.InstanceService",
                "GetInstanceSetting",
                {"name": "instance/settings/STORAGE"},
            )
        except ApiError:
            return None
        mb = setting.get("storageSetting", {}).get("uploadSizeLimitMb")
        return int(mb) * 1024 * 1024 if mb else None


class ApiError(RuntimeError):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(f"HTTP {status}: {detail}")
        self.status = status
        self.detail = detail


def deterministic_attachment_id(doc_rel: str, asset_rel: str) -> str:
    """同一 (文档, 图片) 永远得到同一个 attachment id。

    uid 在库里有唯一约束，所以「服务端已建好、本地清单还没落盘」这种中断状态下重跑，
    会撞唯一约束而不是产生第二份附件 —— 幂等的最后一道保险。
    """
    digest = hashlib.sha256(f"{doc_rel}\x00{asset_rel}".encode("utf-8")).hexdigest()
    return f"kbmig-{digest[:24]}"


# --------------------------------------------------------------------------------------
# 子命令：plan
# --------------------------------------------------------------------------------------


def cmd_plan(args: argparse.Namespace) -> int:
    source: Path = args.source
    work: Path = args.work_dir
    work.mkdir(parents=True, exist_ok=True)

    docs, excluded = load_docs(source)
    assets, all_assets = build_asset_index(source)
    by_stem: dict[str, list[Doc]] = {}
    for doc in docs:
        by_stem.setdefault(doc.stem, []).append(doc)

    issues: list[Issue] = []
    embed_targets: dict[str, list[str]] = {}  # 资源路径 -> 引用它的文档
    link_rows: list[dict] = []
    class_html: dict[str, int] = {}

    for doc in docs:
        embeds, embed_issues = parse_embeds(doc, assets)
        issues.extend(embed_issues)
        for ref in embeds:
            if ref.resolved:
                rel = ref.resolved.relative_to(source).as_posix()
                embed_targets.setdefault(rel, []).append(doc.rel)
                if ref.note:
                    issues.append(Issue("embed-note", doc.rel, f"{ref.raw}：{ref.note}"))

        for ref in parse_links(doc):
            row = {"doc": doc.rel, "raw": ref.raw, "target": ref.doc_target, "anchor": ref.anchor}
            if not ref.doc_target:
                target_doc = doc
            else:
                hits = by_stem.get(ref.doc_target, [])
                if len(hits) != 1:
                    row["result"] = "doc-unresolved"
                    issues.append(
                        Issue(
                            "link-doc-unresolved",
                            doc.rel,
                            f"{ref.raw} -> 找不到唯一文档 {ref.doc_target!r}"
                            + (f"（命中 {len(hits)} 篇）" if hits else ""),
                        )
                    )
                    link_rows.append(row)
                    continue
                target_doc = hits[0]
            row["target_doc"] = target_doc.rel
            if ref.anchor:
                anchor, how = resolve_anchor(ref.anchor, target_doc.headings)
                row["result"] = how
                row["anchor_id"] = anchor
                if anchor is None:
                    issues.append(
                        Issue(
                            "anchor-unmatched",
                            doc.rel,
                            f"{ref.raw} -> 在 {target_doc.rel} 里匹配不到标题（{how}），降级为文档级链接",
                        )
                    )
                elif how not in ("exact", "normalized"):
                    issues.append(
                        Issue("anchor-fuzzy", doc.rel, f"{ref.raw} -> 以 {how} 方式匹配到 {anchor!r}")
                    )
            else:
                row["result"] = "doc-only"
            link_rows.append(row)

        # 源库里已经存在的标准 markdown 目录链接 `](#anchor)`。它们不经过任何转换直接
        # 迁入，所以必须在这里就用平台的 slug 算法验一遍——否则迁完发现目录点不动，
        # 会被当成迁移搞坏的。
        issues.extend(check_existing_anchors(doc))

        _, stripped = strip_class_html(doc.content)
        if stripped:
            class_html[doc.rel] = len(stripped)

    dup_uploads = {k: v for k, v in embed_targets.items() if len(set(v)) > 1}
    unused = [p.relative_to(source).as_posix() for p in all_assets if p.relative_to(source).as_posix() not in embed_targets]
    total_upload_bytes = sum(
        (source / rel).stat().st_size * len(set(docs_)) for rel, docs_ in embed_targets.items()
    )
    largest = sorted(
        ((source / rel).stat().st_size, rel) for rel in embed_targets
    )[-5:][::-1]

    inventory = {
        "source": str(source),
        "docs": [{"rel": d.rel, "headings": len(d.headings), "bytes": len(d.content)} for d in docs],
        "excluded": [{"rel": rel, "reason": reason} for rel, reason in excluded],
        "embeds": {rel: sorted(set(v)) for rel, v in sorted(embed_targets.items())},
        "links": link_rows,
        "class_html": class_html,
        "issues": [{"kind": i.kind, "doc": i.doc, "detail": i.detail} for i in issues],
        "upload_plan": {
            "unique_assets": len(embed_targets),
            "upload_count": sum(len(set(v)) for v in embed_targets.values()),
            "total_bytes": total_upload_bytes,
            "duplicated": {k: sorted(set(v)) for k, v in dup_uploads.items()},
            "largest": [{"rel": rel, "bytes": size} for size, rel in largest],
        },
        "unused_assets": unused,
    }
    (work / "inventory.json").write_text(
        json.dumps(inventory, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"源库：{source}")
    print(f"迁入文档：{len(docs)} 篇；排除 {len(excluded)} 项")
    print(
        f"附件：{len(embed_targets)} 个唯一资源 -> 计划上传 "
        f"{inventory['upload_plan']['upload_count']} 份（{total_upload_bytes / 1048576:.1f} MB）"
    )
    print(f"  其中被多篇引用需重复上传的：{len(dup_uploads)} 个")
    print(f"  库内未被引用、不上传的资源：{len(unused)} 个")
    print(f"内链：{len(link_rows)} 处")
    for how in ("exact", "normalized", "prefix", "reverse-prefix", "doc-only"):
        n = sum(1 for r in link_rows if r.get("result") == how)
        if n:
            print(f"  {how}: {n}")
    degraded = [r for r in link_rows if r.get("result") in ("unmatched", "doc-unresolved", "block-ref", "prefix-ambiguous")]
    print(f"  需降级/丢锚点：{len(degraded)}")
    print(f"带 class 的 HTML：{len(class_html)} 篇，共 {sum(class_html.values())} 处将被剥壳")
    print()
    print("排除清单：")
    for rel, reason in excluded:
        print(f"  - {rel}：{reason}")
    print()
    print(f"完整盘点已写入 {work / 'inventory.json'}")
    print("下一步：核对无误后跑 `migrate.py stage`")
    return 0


# --------------------------------------------------------------------------------------
# 子命令：stage
# --------------------------------------------------------------------------------------


def cmd_stage(args: argparse.Namespace) -> int:
    source: Path = args.source
    work: Path = args.work_dir
    staged = work / "staged"
    if staged.exists():
        shutil.rmtree(staged)
    staged.mkdir(parents=True)

    docs, _ = load_docs(source)
    for doc in docs:
        dest = staged / doc.rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(doc.content, encoding="utf-8")

    # 硬校验：内容树里只能有 .md。memogit 的 listDocFiles 会把其余一切文件都当文档
    # 创建，127 个 PNG 会变成 127 篇正文是二进制乱码的「文档」。
    strays = [
        p.relative_to(staged).as_posix()
        for p in staged.rglob("*")
        if p.is_file() and p.suffix.lower() not in DOC_SUFFIXES
    ]
    if strays:
        print("内容树里混进了非文档文件，已中止：", file=sys.stderr)
        for s in strays:
            print(f"  {s}", file=sys.stderr)
        return 1

    print(f"已产出 {len(docs)} 篇到 {staged}")
    print("其中正文里的 ![[...]] / [[...]] 尚未转换 —— 这是有意的，先 push 换取 memo uid。")
    print()
    print("接下来人工执行：")
    print(f"  cd {args.checkout.parent}")
    print(f"  memogit clone <workspace> --dir {args.checkout.name}   # 若尚未 clone")
    print(f"  rsync -a --delete-excluded {staged}/ {args.checkout}/")
    print("  memogit status && memogit push")
    print(f"然后跑：migrate.py attach --state <checkout>/.memogit/... 见 README")
    return 0


# --------------------------------------------------------------------------------------
# 子命令：attach
# --------------------------------------------------------------------------------------


def load_uid_map(state_path: Path) -> dict[str, str]:
    """从 memogit 的 sync-state 反解 path -> memo uid。"""
    state = json.loads(state_path.read_text(encoding="utf-8"))
    mapping: dict[str, str] = {}
    for uid, entry in state.get("memos", {}).items():
        path = entry.get("path")
        if path:
            mapping[path] = uid
    return mapping


class UploadLedger:
    """(源资源, 所属文档) -> attachment 的幂等清单。断点续跑靠它。"""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.data: dict[str, dict] = {}
        if path.exists():
            self.data = json.loads(path.read_text(encoding="utf-8"))

    @staticmethod
    def key(doc_rel: str, asset_rel: str) -> str:
        return f"{doc_rel}\x00{asset_rel}"

    def get(self, doc_rel: str, asset_rel: str) -> dict | None:
        return self.data.get(self.key(doc_rel, asset_rel))

    def put(self, doc_rel: str, asset_rel: str, record: dict) -> None:
        self.data[self.key(doc_rel, asset_rel)] = record
        # 每次都落盘：宁可多写几十次，也不要在中断时丢掉已上传的记录
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)


def cmd_attach(args: argparse.Namespace) -> int:
    source: Path = args.source
    work: Path = args.work_dir
    work.mkdir(parents=True, exist_ok=True)

    uid_map = load_uid_map(args.state)
    docs, _ = load_docs(source)
    assets, _ = build_asset_index(source)
    by_stem: dict[str, list[Doc]] = {}
    for doc in docs:
        by_stem.setdefault(doc.stem, []).append(doc)

    missing = [d.rel for d in docs if d.rel not in uid_map]
    if missing:
        print(f"以下 {len(missing)} 篇在 memogit state 里找不到 uid —— 第一趟 push 没跑完？", file=sys.stderr)
        for rel in missing[:20]:
            print(f"  {rel}", file=sys.stderr)
        return 1

    client: ToucanClient | None = None
    size_limit: int | None = None
    if not args.dry_run:
        client = ToucanClient(args.server, args.token)
        size_limit = client.upload_size_limit_bytes()

    # 开跑前先体检：最大的文件也得塞得进上传上限，不要传到一半才失败
    effective_limit = size_limit if size_limit else args.assume_upload_limit_mb * 1024 * 1024
    oversized = []
    for doc in docs:
        for ref in parse_embeds(doc, assets)[0]:
            if ref.resolved and ref.resolved.stat().st_size > effective_limit:
                oversized.append((ref.resolved.relative_to(source).as_posix(), ref.resolved.stat().st_size))
    if oversized:
        print(
            f"以下文件超过上传上限（{effective_limit / 1048576:.0f} MB，"
            + ("读自实例设置" if size_limit else "未能读到实例设置，用 --assume-upload-limit-mb 假定")
            + "），已中止：",
            file=sys.stderr,
        )
        for rel, size in sorted(set(oversized)):
            print(f"  {rel}  {size / 1048576:.1f} MB", file=sys.stderr)
        return 1

    # dry-run 用独立的清单文件。若共用一份，dry-run 会把「已上传」写满，
    # 紧接着的实跑会认为一切都已完成、一个附件都不传 —— 而正文里全是不存在的 uid。
    ledger = UploadLedger(work / ("uploads.dryrun.json" if args.dry_run else "uploads.json"))
    final = work / "final"
    final.mkdir(parents=True, exist_ok=True)
    report: list[Issue] = []
    uploaded_now = 0
    uploaded_bytes = 0

    for doc in docs:
        memo_uid = uid_map[doc.rel]
        content = doc.content

        # ---- 1. 图片：先上传拿 uid，再回写 URL ----
        embeds, embed_issues = parse_embeds(doc, assets)
        report.extend(embed_issues)
        url_by_raw: dict[str, str] = {}
        for ref in embeds:
            if ref.resolved is None:
                continue
            if ref.note:
                report.append(Issue("embed-note", doc.rel, f"{ref.raw}：{ref.note}"))
            asset_rel = ref.resolved.relative_to(source).as_posix()
            record = ledger.get(doc.rel, asset_rel)
            if record is None:
                att_id = deterministic_attachment_id(doc.rel, asset_rel)
                filename = ref.resolved.name
                mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
                data = ref.resolved.read_bytes()
                if args.dry_run:
                    record = {"uid": att_id, "filename": filename, "size": len(data), "dry_run": True}
                else:
                    assert client is not None
                    try:
                        att = client.create_attachment(
                            attachment_id=att_id,
                            filename=filename,
                            mime=mime,
                            content=data,
                            memo_name=f"memos/{memo_uid}",
                        )
                    except ApiError as exc:
                        # 上一轮可能已经建好了，只是清单没落盘。确定性 id 让我们能认回来。
                        try:
                            att = client.get_attachment(att_id)
                        except ApiError:
                            print(f"上传失败 {asset_rel} -> {doc.rel}：{exc}", file=sys.stderr)
                            return 1
                    record = {
                        "uid": att["name"].split("/")[-1],
                        "name": att["name"],
                        "filename": att.get("filename", filename),
                        "size": len(data),
                        "memo": f"memos/{memo_uid}",
                    }
                    uploaded_now += 1
                    uploaded_bytes += len(data)
                    print(f"  上传 {asset_rel} -> {doc.rel} ({len(data) / 1024:.0f} KB)")
                ledger.put(doc.rel, asset_rel, record)
            name = record.get("name") or f"attachments/{record['uid']}"
            url_by_raw[ref.raw] = attachment_url(name, record["filename"])

        def repl_embed(m: re.Match[str], _map=url_by_raw, _doc=doc) -> str:
            url = _map.get(m.group(0))
            if url is None:
                return m.group(0)  # 解析不到的原样留着，由复核报告负责暴露
            alt = Path(m.group(1).split("|")[0].strip()).stem
            return f"![{alt}]({url})"

        content = sub_outside_protected(EMBED_RE, content, repl_embed)

        # ---- 2. 内链 ----
        def repl_link(m: re.Match[str], _doc=doc) -> str:
            inner = m.group(1)
            body, _, alias = inner.partition("|")
            target, _, anchor = body.partition("#")
            target, anchor, alias = target.strip(), anchor.strip(), alias.strip()

            if target:
                hits = by_stem.get(target, [])
                if len(hits) != 1:
                    report.append(
                        Issue("link-doc-unresolved", _doc.rel, f"{m.group(0)} -> 找不到唯一文档，降级为纯文本")
                    )
                    return alias or (f"{target} > {anchor}" if anchor else target)
                target_doc = hits[0]
                target_uid = uid_map[target_doc.rel]
            else:
                target_doc = _doc
                target_uid = None  # 同文档链接不带 /memos 前缀

            anchor_id = None
            if anchor:
                anchor_id, how = resolve_anchor(anchor, target_doc.headings)
                if anchor_id is None:
                    report.append(
                        Issue(
                            "anchor-unmatched",
                            _doc.rel,
                            f"{m.group(0)} -> 在 {target_doc.rel} 匹配不到标题（{how}），"
                            + ("降级为文档级链接" if target else "降级为纯文本"),
                        )
                    )
                elif how not in ("exact", "normalized"):
                    report.append(
                        Issue("anchor-fuzzy", _doc.rel, f"{m.group(0)} -> {how} 匹配到 #{anchor_id}")
                    )

            # 链接文字：显式别名优先；没有别名时，锚点丢了就只留文档名，
            # 免得正文里留下 `[6.1 NLP 入门#单词嵌入 Word Embedding](...)` 这种半截语法。
            if alias:
                label = alias
            elif target and anchor and anchor_id:
                label = f"{target} > {anchor}"
            else:
                label = target or anchor

            if target_uid is None:
                if anchor_id is None:
                    return label
                return f"[{label}](#{anchor_id})"
            return f"[{label}]({memo_url(target_uid, anchor_id or '')})"

        content = sub_outside_protected(WIKILINK_RE, content, repl_link)

        # ---- 3. 源库里已经指不中的 `](#anchor)` 目录链接 ----
        # 默认**只报告不修改**：这是源库的存量问题，不是迁移引入的，交给作者自己处理。
        # 加 --fix-anchors 才会动手，且只在目标标题唯一确定时才改（exact / normalized，
        # 也就是纯大小写或标点差异），prefix 这类需要判断的一律不动。
        valid = {h.anchor for h in doc.headings}

        def repl_anchor(m: re.Match[str], _doc=doc, _valid=valid) -> str:
            anchor = urllib.parse.unquote(m.group(1))
            if anchor in _valid:
                return m.group(0)
            fixed, how = resolve_anchor(anchor, _doc.headings)
            if fixed and how in ("exact", "normalized") and args.fix_anchors:
                report.append(
                    Issue("existing-anchor-fixed", _doc.rel, f"](#{anchor}) -> ](#{fixed})（{how}）")
                )
                return f"](#{fixed})"
            report.append(
                Issue(
                    "existing-anchor-broken",
                    _doc.rel,
                    f"](#{anchor}) 指不中"
                    + (f"，最接近的是 #{fixed}（{how}）" if fixed else "，本篇找不到对应标题")
                    + "，未改动",
                )
            )
            return m.group(0)

        content = sub_outside_protected(MD_ANCHOR_LINK_RE, content, repl_anchor)

        # ---- 4. 带 class 的 HTML 剥壳 ----
        content, stripped = strip_class_html(content)
        for snippet in stripped:
            flat = " ".join(snippet.split())
            report.append(Issue("html-stripped", doc.rel, flat[:200] + ("…" if len(flat) > 200 else "")))

        dest = final / doc.rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content, encoding="utf-8")

    (work / "report.json").write_text(
        json.dumps(
            [{"kind": i.kind, "doc": i.doc, "detail": i.detail} for i in report],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    mode = "DRY-RUN（未发任何写请求）" if args.dry_run else "实跑"
    print(f"\n{mode} 完成：{len(docs)} 篇已写入 {final}")
    print(f"本次上传 {uploaded_now} 个附件（{uploaded_bytes / 1048576:.1f} MB）；"
          f"清单累计 {len(ledger.data)} 条 -> {ledger.path}")
    print(f"复核条目 {len(report)} 条 -> {work / 'report.json'}（跑 `migrate.py report` 出可读版本）")
    if not args.dry_run:
        print()
        print("接下来人工执行：")
        print(f"  rsync -a {final}/ {args.checkout}/")
        print("  memogit status   # 应显示全部文档为「已修改」")
        print("  memogit push")
    return 0


# --------------------------------------------------------------------------------------
# 子命令：report
# --------------------------------------------------------------------------------------

REPORT_SECTIONS = [
    ("anchor-unmatched", "锚点匹配不上，已降级（源库存量死链，预期存在）"),
    ("link-doc-unresolved", "内链目标文档找不到，已降级为纯文本"),
    ("anchor-fuzzy", "锚点靠模糊匹配救回（需抽查是否指对了）"),
    ("embed-unresolved", "图片引用找不到文件（正文保留原样，必须人工处理）"),
    ("embed-ambiguous", "图片 basename 重名，无法确定（必须人工处理）"),
    ("embed-note", "图片引用的特殊写法"),
    ("existing-anchor-broken", "源库自带的 ](#anchor) 目录链接指不中（存量问题，原样迁入，交作者处理）"),
    ("existing-anchor-fixed", "源库自带的 ](#anchor) 目录链接已按平台 slug 规则自动修正（--fix-anchors）"),
    ("html-stripped", "被剥壳的带 class HTML 片段"),
]


def cmd_report(args: argparse.Namespace) -> int:
    work: Path = args.work_dir
    report_path = work / "report.json"
    if not report_path.exists():
        print(f"没有 {report_path}，先跑 `migrate.py attach`", file=sys.stderr)
        return 1
    issues = json.loads(report_path.read_text(encoding="utf-8"))
    ledger_path = work / "uploads.json"
    ledger_note = ""
    if not ledger_path.exists() and (work / "uploads.dryrun.json").exists():
        ledger_path = work / "uploads.dryrun.json"
        ledger_note = "（**DRY-RUN 演算值**，附件尚未真正上传）"
    ledger = UploadLedger(ledger_path)

    by_kind: dict[str, list[dict]] = {}
    for issue in issues:
        by_kind.setdefault(issue["kind"], []).append(issue)

    lines = ["# 迁移复核报告", ""]
    total_bytes = sum(r.get("size", 0) for r in ledger.data.values())
    assets = {k.split("\x00")[1] for k in ledger.data}
    lines += [
        f"## 附件{ledger_note}",
        "",
        f"- 上传份数：{len(ledger.data)}",
        f"- 唯一源文件：{len(assets)}（差额 = 被多篇引用而重复上传的份数）",
        f"- 总字节：{total_bytes} B（{total_bytes / 1048576:.1f} MB）",
        "",
    ]
    dup: dict[str, list[str]] = {}
    for key in ledger.data:
        doc_rel, asset_rel = key.split("\x00")
        dup.setdefault(asset_rel, []).append(doc_rel)
    repeated = {k: v for k, v in dup.items() if len(v) > 1}
    if repeated:
        lines.append(f"### 重复上传的图片（{len(repeated)} 张）")
        lines.append("")
        lines.append("一张图被 N 篇引用就传 N 份，各自挂在引用它的文档上——共享同一个 attachment")
        lines.append("会让第二篇的图片能否显示取决于第一篇的可见性。")
        lines.append("")
        for asset_rel, docs_ in sorted(repeated.items()):
            lines.append(f"- `{asset_rel}` -> " + "、".join(f"`{d}`" for d in sorted(docs_)))
        lines.append("")

    for kind, title in REPORT_SECTIONS:
        rows = by_kind.pop(kind, [])
        lines.append(f"## {title}（{len(rows)}）")
        lines.append("")
        if not rows:
            lines.append("无。")
        for row in rows:
            lines.append(f"- `{row['doc']}`：{row['detail']}")
        lines.append("")

    for kind, rows in by_kind.items():
        lines.append(f"## 其他：{kind}（{len(rows)}）")
        lines.append("")
        for row in rows:
            lines.append(f"- `{row['doc']}`：{row['detail']}")
        lines.append("")

    out = work / "report.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines[:60]))
    print(f"\n…完整报告：{out}")
    return 0


# --------------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help=f"源 Obsidian 库（只读），默认 {DEFAULT_SOURCE}")
    parser.add_argument("--work-dir", type=Path, default=DEFAULT_WORK, help=f"工作目录，默认 {DEFAULT_WORK}")
    parser.add_argument(
        "--checkout",
        type=Path,
        default=Path.home() / "Workspace/MemoBase/AI_Handbook",
        help="memogit checkout 里该 workspace 的目录（脚本只用于提示命令，不写入）",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_plan = sub.add_parser("plan", help="只读盘点，不发写请求")
    p_plan.set_defaults(func=cmd_plan)

    p_stage = sub.add_parser("stage", help="产出第一趟 push 的文档树")
    p_stage.set_defaults(func=cmd_stage)

    p_attach = sub.add_parser("attach", help="上传附件并回写正文")
    p_attach.add_argument("--state", type=Path, required=True, help="memogit 的 .memogit/state/<ws>.json")
    p_attach.add_argument("--server", default=os.environ.get("TOUCAN_SERVER", ""), help="服务器地址，或用 TOUCAN_SERVER")
    p_attach.add_argument("--token", default=os.environ.get("TOUCAN_TOKEN", ""), help="PAT，或用 TOUCAN_TOKEN")
    p_attach.add_argument("--dry-run", action="store_true", help="不发任何写请求，只演算并产出正文")
    p_attach.add_argument("--assume-upload-limit-mb", type=int, default=32, help="读不到实例设置时假定的上传上限")
    p_attach.add_argument(
        "--fix-anchors",
        action="store_true",
        help="顺手修正源库里已经指不中的 ](#anchor) 目录链接（默认只报告不改）",
    )
    p_attach.set_defaults(func=cmd_attach)

    p_report = sub.add_parser("report", help="生成人工复核报告")
    p_report.set_defaults(func=cmd_report)

    args = parser.parse_args(argv)

    if args.cmd == "attach" and not args.dry_run and not (args.server and args.token):
        parser.error("实跑需要 --server 和 --token（或 TOUCAN_SERVER / TOUCAN_TOKEN）")
    if not args.source.is_dir():
        parser.error(f"源库不存在：{args.source}")
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
