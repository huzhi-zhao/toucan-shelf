"""ToucanShelf 标题锚点 slug 算法的 Python 复刻。

对应的 TypeScript 源实现：
  - web/src/utils/markdown-manipulation.ts  的 `slugify` / `shortHash` / `headingSlug`
  - web/src/utils/rehype-plugins/rehype-heading-id.ts 的重名计数规则

锚点算错 = 全部文档内链失效，所以这里逐条对着 JS 语义写，
并由 test_slugify_port.py 直接从 .ts 源文件抽出函数体做对拍。
"""

from __future__ import annotations

import unicodedata

# JS 的 \s（带 u 标志）字符集。Python 的 str.isspace() 与之不完全一致
# （多收 \x1c-\x1f，少收 ﻿），这里显式列出以保证 trim 和空白替换的行为一致。
JS_WHITESPACE = frozenset(
    [
        "\t",
        "\n",
        "\v",
        "\f",
        "\r",
        " ",
        " ",
        " ",
        *(chr(c) for c in range(0x2000, 0x200B)),
        " ",
        " ",
        " ",
        " ",
        "　",
        "﻿",
    ]
)

_JS_WHITESPACE_STR = "".join(sorted(JS_WHITESPACE))


def js_trim(text: str) -> str:
    """String.prototype.trim()：按 JS 的空白定义去首尾。"""
    return text.strip(_JS_WHITESPACE_STR)


def _is_letter_or_number(ch: str) -> bool:
    """对应 JS 正则里的 \\p{L} 和 \\p{N}。"""
    return unicodedata.category(ch)[0] in ("L", "N")


def slugify(text: str) -> str:
    """复刻 markdown-manipulation.ts 的 slugify()。

    NFC 归一化 -> 转小写 -> trim -> 丢掉非「字母/数字/空白/连字符」的字符（emoji、
    标点、括号都在此被丢掉）-> 空白和下划线转 `-` -> 折叠连续 `-` -> 去首尾 `-`。
    """
    s = js_trim(unicodedata.normalize("NFC", text).lower())

    # .replace(/[^\p{L}\p{N}\s-]/gu, "")
    kept = [ch for ch in s if _is_letter_or_number(ch) or ch in JS_WHITESPACE or ch == "-"]

    # .replace(/[\s_]+/g, "-")
    # 注意：`_` 在上一步就已被丢掉（它既非 \p{L}\p{N} 也非空白），这里保留对下划线的
    # 处理只是为了与源实现逐句对应。
    out: list[str] = []
    prev_was_sep = False
    for ch in kept:
        if ch in JS_WHITESPACE or ch == "_":
            if not prev_was_sep:
                out.append("-")
            prev_was_sep = True
        else:
            out.append(ch)
            prev_was_sep = False
    s = "".join(out)

    # .replace(/-+/g, "-")
    collapsed: list[str] = []
    for ch in s:
        if ch == "-" and collapsed and collapsed[-1] == "-":
            continue
        collapsed.append(ch)
    s = "".join(collapsed)

    # .replace(/^-|-$/g, "")  —— 上一步已折叠，去掉首尾各一个即可
    if s.startswith("-"):
        s = s[1:]
    if s.endswith("-"):
        s = s[:-1]
    return s


def _int32(value: int) -> int:
    """把 Python 整数截成 JS 的有符号 32 位整数语义（对应 `<<` 的结果类型）。"""
    value &= 0xFFFFFFFF
    return value - 0x100000000 if value >= 0x80000000 else value


def short_hash(text: str) -> str:
    """复刻 shortHash()：sdbm 哈希 -> base36。

    JS 的 charCodeAt() 取的是 UTF-16 码元，所以 emoji 这类星平面字符会被拆成
    代理对参与运算——必须按 utf-16-le 逐 16 位读，不能按 Python 的码点遍历。
    """
    units = text.encode("utf-16-le")
    h = 0
    for i in range(0, len(units), 2):
        code = units[i] | (units[i + 1] << 8)
        # JS: h = (code + (h << 6) + (h << 16) - h) >>> 0
        h = (code + _int32(h << 6) + _int32(h << 16) - h) & 0xFFFFFFFF

    if h == 0:
        return "0"
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while h:
        h, rem = divmod(h, 36)
        out = digits[rem] + out
    return out


def heading_slug(text: str) -> str:
    """复刻 headingSlug()：slug 为空时回退到 `h-<shorthash>`，绝不返回空串。"""
    slug = slugify(text)
    if slug:
        return slug
    return "h-" + short_hash(js_trim(unicodedata.normalize("NFC", text)))


class HeadingIndex:
    """按 rehype-heading-id 的规则给一篇文档的所有标题分配最终锚点 id。

    规则：按文档顺序遍历 h1-h6（**包含裸 HTML 写的标题**，因为它们在 hast 里同样是
    h1-h6 元素），同一 slug 第 n 次出现（n 从 0 计）时 id 为 `slug` / `slug-1` / `slug-2`…
    """

    def __init__(self) -> None:
        self._counts: dict[str, int] = {}
        self.entries: list[tuple[str, str]] = []  # (标题原文, 锚点 id)，按文档顺序

    def add(self, text: str) -> str:
        slug = heading_slug(text)
        count = self._counts.get(slug, 0)
        self._counts[slug] = count + 1
        anchor = slug if count == 0 else f"{slug}-{count}"
        self.entries.append((text, anchor))
        return anchor
