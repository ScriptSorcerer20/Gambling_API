const {test,expect} = require('@playwright/test');
async function register(page,name) {
    await page.goto('/login');
    await page.getByLabel('Username',{exact:true}).fill(name);
    await page.getByLabel('Password',{exact:true}).fill('test-password');
    await page.getByRole('button',{name:'Register',exact:true}).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#balance')).toHaveText('200');
}
test('two-player table, reload, reconnect, modal keyboard access, and leave',async({browser})=>{
    const first=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
    const second=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
    const a=await first.newPage(), b=await second.newPage();
    const errors=[];a.on('pageerror',error=>errors.push(error.message));b.on('pageerror',error=>errors.push(error.message));
    try {
        await register(a,`alice-${Date.now()}`);await register(b,`bob-${Date.now()}`);
        await a.getByRole('button',{name:'Host Lobby',exact:true}).click();
        await a.getByRole('button',{name:'Create Lobby',exact:true}).click();
        await expect(a.locator('#lobby-id')).not.toHaveText('N/A');
        const lobbyId=await a.locator('#lobby-id').textContent();
        await b.getByRole('button',{name:'Join Lobby',exact:true}).click();
        await b.getByLabel('Lobby code').fill(lobbyId);
        await b.locator('#submit-join').click();
        await expect(a.locator('#start-game')).toBeEnabled();
        await a.locator('#start-game').click();
        await expect(a).toHaveURL(/poker.html/);await expect(b).toHaveURL(/poker.html/);
        await expect(b.locator('[data-action="bet"]')).toBeEnabled();
        await b.locator('[data-action="bet"]').click();
        await expect(b.locator('#bet-range')).toBeFocused();
        await expect(b.locator('#range-max')).toHaveText('$190');
        await b.keyboard.press('Escape');await expect(b.locator('#bet-modal')).toBeHidden();
        await expect(b.locator('[data-action="bet"]')).toBeFocused();
        await b.locator('[data-action="hit"]').click();
        await expect(a.locator('[data-action="hit"]')).toBeEnabled();
        const before=await a.locator('#player-cards').textContent();
        await a.reload();await expect(a.locator('[data-action="hit"]')).toBeEnabled();
        await expect(a.locator('#player-cards')).toHaveText(before);
        await first.setOffline(true);await a.evaluate(()=>window.dispatchEvent(new Event('offline')));
        await first.setOffline(false);
        await expect(a.locator('[data-action="hit"]')).toBeEnabled({timeout:10000});
        await a.locator('[data-action="hit"]').click();
        await expect(a.locator('#street')).toHaveText('flop');
        for(const page of [a,b]) {
            expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
        await a.screenshot({path:'test-results/mobile-table.png',fullPage:true});
        await b.locator('#leave-table').click();await expect(b).toHaveURL(/\/$/);
        expect(errors).toEqual([]);
    } finally {await first.close();await second.close();}
});
test('login fits a narrow viewport and protected pages redirect',async({page})=>{
    await page.setViewportSize({width:320,height:568});await page.goto('/poker.html');
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByLabel('Username',{exact:true})).toBeVisible();
});
