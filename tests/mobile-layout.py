"""Offline Chromium layout checks. Run: python tests/mobile-layout.py.
Requires Playwright and Chromium (CHROMIUM_PATH may override the executable).
Uses layout fixtures; never calls live APIs or changes customer data.
"""
import asyncio
import json
import os
import re
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
SIZES = [(320, 740), (375, 812), (390, 844), (430, 932), (768, 1024), (844, 390), (1280, 900)]
USERS = [{"id": 1, "fname": "مشتری آزمایشی — Mobile customer", "email": "long.customer.address.for.mobile@example.test",
          "balance": 123456.78, "transactions": [
              {"id": f"refund-{i}", "type": "refund", "orderId": f"177000000000{i}", "amount": 12.3456,
               "date": "2026-10-26T12:00:00Z", "status": "approved"} for i in range(12)]}]

async def main():
    checks = 0
    artifacts = ROOT / "artifacts"
    artifacts.mkdir(exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"),
                                          headless=True, args=["--no-sandbox"])
        page = await browser.new_page(viewport={"width": 320, "height": 740}, is_mobile=True, has_touch=True)

        async def route(request):
            name = request.request.url.rsplit("/", 1)[-1].split("?")[0]
            file = ROOT / name
            if file.is_file() and file.suffix in (".html", ".css"):
                source = file.read_text()
                if file.suffix == ".html":
                    source = re.sub(r"<script\b[^>]*>[\s\S]*?</script>", "", source, flags=re.I)
                await request.fulfill(body=source, content_type="text/css" if file.suffix == ".css" else "text/html")
            else:
                await request.abort()

        await page.route("**/*", route)

        async def fits(label, width):
            nonlocal checks
            size = await page.evaluate("""() => ({width: innerWidth, scroll: document.documentElement.scrollWidth})""")
            assert size["width"] <= width + 1 and size["scroll"] <= width + 1, (label, width, size)
            checks += 1

        async def show(id):
            await page.evaluate("""id => {
              document.querySelectorAll('.page').forEach(p => {p.classList.remove('on','active'); p.style.display='none'});
              const el=document.getElementById(id); el.style.display='block';
              el.classList.add(document.body.classList.contains('admin-panel')?'on':'active');
              window.scrollTo(0,0);
            }""", id)

        for name in ("admin.html", "smm-panel.html"):
            await page.goto("http://panel.test/" + name)
            if name == "admin.html":
                await fits("admin login", 320)
                await page.evaluate("document.querySelector('#admin-login-screen').remove()")
                source = (ROOT / name).read_text()
                report = source[source.index("function getAdminRefundRows("):source.index("// ═══ NAV ═══")]
                await page.evaluate("""users => {
                    window.getRealUsers=()=>users;
                    window.escHtmlAdmin=s=>{const d=document.createElement('div');d.textContent=String(s);return d.innerHTML;};
                }""", USERS)
                await page.add_script_tag(content=report)
                await page.evaluate("rRefunds()")
            else:
                source = (ROOT / name).read_text()
                report = source[source.index("function renderRefunds("):source.index("function closeRefundsModal(")]
                await page.evaluate("""user => {
                    window.getCurrentUser=()=>user;
                    window.fmt=n=>'$'+Number(n).toFixed(4);
                    window.showToast=()=>{};
                    window.escHtml=s=>{const d=document.createElement('div');d.textContent=String(s);return d.innerHTML;};
                    document.querySelector('#top-balance-amt').textContent='$123,456.78';
                }""", USERS[0])
                await page.add_script_tag(content=report)
            ids = await page.locator(".page").evaluate_all("els=>els.map(e=>e.id)")
            for width, height in SIZES:
                await page.set_viewport_size({"width": width, "height": height})
                for id in ids:
                    await show(id)
                    await fits(id, width)
                if name == "admin.html":
                    await show("pg-refunds")
                    assert await page.locator("#admin-refunds-tbl tbody tr").count() == 12
                    cell_display = await page.locator("#admin-refunds-tbl td").first.evaluate("e=>getComputedStyle(e).display")
                    assert cell_display == ("grid" if width <= 600 else "table-cell"), (width, cell_display)
                    await page.locator("#admin-rf-search").fill("1770000000005")
                    await page.evaluate("rRefunds()")
                    assert await page.locator("#admin-refunds-tbl tbody tr").count() == 1
                    await page.locator("#admin-rf-search").fill("")
                    await page.evaluate("rRefunds()")
                    if width == 390:
                        await page.wait_for_timeout(350)
                        await page.screenshot(path=str(artifacts / "admin-refunds-mobile.png"))
                    if width <= 768:
                        for modal in ("#m-add-bal", "#m-user-report"):
                            await page.locator(modal).evaluate("e=>e.classList.add('open')")
                            box = await page.locator(modal + " .md").bounding_box()
                            assert box and box["x"] >= -1 and box["y"] >= -1 and box["width"] <= width+1, (modal, box)
                            checks += 1
                            await page.locator(modal).evaluate("e=>e.classList.remove('open')")
                else:
                    await page.evaluate("renderRefunds()")
                    await fits("customer refund sheet", width)
                    button = await page.locator("#t-rf-close").bounding_box()
                    assert button and 0 <= button["y"] and button["y"]+button["height"] <= height+1, button
                    await page.locator("#rf-list").evaluate("e=>e.scrollTop=e.scrollHeight")
                    if width == 390:
                        await page.screenshot(path=str(artifacts / "customer-refunds-mobile.png"))
                    await page.locator("#refunds-modal").evaluate("e=>e.style.display='none'")
                    await show("page-new-order")
                    if width == 390:
                        await page.wait_for_timeout(350)
                        await page.screenshot(path=str(artifacts / "customer-panel-mobile.png"))
                    await page.locator("#ai-widget").evaluate("e=>e.style.display='flex'")
                    box = await page.locator("#ai-widget").bounding_box()
                    assert box and box["x"] >= -1 and box["y"] >= -1 and box["x"]+box["width"] <= width+1, box
                    await page.locator("#ai-widget").evaluate("e=>e.style.display='none'")
                    checks += 2
        await browser.close()
    print(json.dumps({"layout_checks": checks, "viewport_sizes": SIZES, "result": "passed"}))

asyncio.run(main())
