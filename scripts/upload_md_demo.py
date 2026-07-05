import subprocess, json, os

# ── 将上方生成的报告内容赋值给此变量 ──
report = """this is a test"""

# file_path = "子目录/文件名"，会被拆成 folder_path + title 传给 API
# （API 目前没有单独的 file_path 字段，只有 folder_path 和 title）
file_path = "ircc/test-3.md"
folder_path, filename = os.path.split(file_path)
title, _ext = os.path.splitext(filename)

payload = json.dumps({
    "content": report,
    "visibility": "PRIVATE",
    "folderPath": folder_path,
    "title": title,
    "workspace": "Trends",
})

result = subprocess.run([
    "curl", "-s", "-X", "POST",
    "https://memos.huzhi.dev/api/v1/memos",
    "-H", "Authorization: Bearer memos_pat_6KghOpYarOCXUmCvm2L8DoCZQg1HnekK",
    "-H", "Content-Type: application/json",
    "-d", payload,
], capture_output=True, text=True)

response = result.stdout.strip()
print("📤 API Response:", response)

try:
    data = json.loads(response)
    if "name" in data:
        print(f"✅ 写入成功：{data['name']}（folderPath: {data.get('folderPath')}, title: {data.get('title')}）")
    else:
        print("❌ 写入失败，返回内容：", response)
except Exception as e:
    print("❌ 解析失败：", e)
    print("stderr:", result.stderr)
