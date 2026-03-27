import urllib.request
import json
import os

# Read the saved markdown file
md_path = r"C:\Users\kazhou\.openclaw\workspace\agentprobe\docs\blog\devto-testing-article.md"
with open(md_path, "r", encoding="utf-8") as f:
    content = f.read()

# Strip the frontmatter (between --- markers)
parts = content.split("---", 2)
if len(parts) >= 3:
    body_markdown = parts[2].strip()
else:
    body_markdown = content

payload = {
    "article": {
        "title": "Your AI Agent Has No Tests \u2014 Here's How to Fix That in 5 Minutes",
        "body_markdown": body_markdown,
        "published": True,
        "tags": ["ai", "testing", "typescript", "opensource"]
    }
}

data = json.dumps(payload).encode("utf-8")

req = urllib.request.Request(
    "https://dev.to/api/articles",
    data=data,
    method="POST"
)
req.add_header("api-key", "Gk4viv7m2hDno6vwBkRYRN7e")
req.add_header("User-Agent", "Mozilla/5.0")
req.add_header("Content-Type", "application/json")

try:
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode("utf-8"))
        print("STATUS:", resp.status)
        print("URL:", result.get("url", "N/A"))
        print("ID:", result.get("id", "N/A"))
        print("SLUG:", result.get("slug", "N/A"))
except urllib.error.HTTPError as e:
    print("ERROR:", e.code)
    print(e.read().decode("utf-8"))
