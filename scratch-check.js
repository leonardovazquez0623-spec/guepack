const { chromium } = require('playwright')

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()

  const errors = []
  page.on('pageerror', err => errors.push('pageerror: ' + err.message))
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('console.error: ' + msg.text())
  })

  console.log('--- menu.html ---')
  await page.goto('http://localhost:4173/menu.html', { waitUntil: 'networkidle', timeout: 20000 }).catch(e => console.log('goto warning:', e.message))
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'scratch-shot-menu-home.png' })
  console.log('screenshot: home saved')

  // Try opening a product detail if a card exists
  const card = await page.$('.product-card, .destacado-card')
  if (card) {
    await card.click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: 'scratch-shot-menu-detail.png' })
    console.log('screenshot: product detail saved')
    const closeBtn = await page.$('[data-close-product]')
    if (closeBtn) await closeBtn.click()
    await page.waitForTimeout(400)
  } else {
    console.log('no product card found (likely empty menu / data load failure) - skipping detail modal shot')
  }

  // Open cart drawer regardless of item count by removing [hidden] via evaluate, to check drawer UI
  await page.evaluate(() => {
    document.getElementById('cart-fab').removeAttribute('hidden')
  })
  const fab = await page.$('#cart-fab')
  if (fab) {
    await fab.click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'scratch-shot-menu-cart.png' })
    console.log('screenshot: cart drawer saved')
    const closeCart = await page.$('#cart-overlay [data-close]')
    if (closeCart) await closeCart.click()
    await page.waitForTimeout(300)
  }

  // Bottom nav -> Cuenta
  const cuentaBtn = await page.$('[data-nav="cuenta"]')
  if (cuentaBtn) {
    await cuentaBtn.click()
    await page.waitForTimeout(800)
    await page.screenshot({ path: 'scratch-shot-menu-cuenta.png' })
    console.log('screenshot: cuenta view saved')
  }

  console.log('MENU ERRORS:', JSON.stringify(errors, null, 2))

  const errors2 = []
  page.removeAllListeners('pageerror')
  page.removeAllListeners('console')
  page.on('pageerror', err => errors2.push('pageerror: ' + err.message))
  page.on('console', msg => { if (msg.type() === 'error') errors2.push('console.error: ' + msg.text()) })

  console.log('--- splash.html ---')
  await page.goto('http://localhost:4173/splash.html', { waitUntil: 'networkidle', timeout: 20000 }).catch(e => console.log('goto warning:', e.message))
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'scratch-shot-splash-legacy.png' })
  console.log('screenshot: splash (legacy/paqueteria) saved')
  console.log('SPLASH ERRORS:', JSON.stringify(errors2, null, 2))

  // Force restaurant onboarding view directly (bypassing live tenant type) to verify the new UI renders
  await page.evaluate(() => {
    if (typeof mostrarOnboardingRestauranteDebug === 'function') return
    document.getElementById('legacy-splash').hidden = true
    const onboarding = document.getElementById('onboarding-splash')
    onboarding.hidden = false
    document.getElementById('onboarding-tagline').textContent = 'Tu café favorito, donde tú estés.'
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'scratch-shot-splash-onboarding.png' })
  console.log('screenshot: splash (forced restaurant onboarding) saved')

  await browser.close()
}

main().catch(err => { console.error('FATAL', err); process.exit(1) })
