import { app } from 'electron'
import { checkAndRequestPermissions } from '../src/main/permission'

app.whenReady().then(async () => {
  try {
    await checkAndRequestPermissions()

    const action = process.env.TEST_MODE
    console.log(`\n\n--- 🚀 Running isolated atom CLI test: ${action} ---\n\n`)

    console.log(`Test mode "${action}" is no longer available (auto-reply engine removed).`)
  } catch (err) {
    console.error(err)
  } finally {
    console.log('\n\n--- 🏁 CLI Test Finished ---\n\n')
    app.quit()
  }
})
