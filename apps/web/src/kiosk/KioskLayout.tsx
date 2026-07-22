import { Outlet } from 'react-router'
import { Rail } from './components/Rail'
import { Topbar } from './components/Topbar'
import { OfflineBanner } from './components/OfflineBanner'
import { SyncHealthBanner } from './components/SyncHealthBanner'
import { UpdateModal } from './components/UpdateModal'
import { VoiceHud } from './components/VoiceHud'
import { Timers } from './components/Timers'
import { EventStyleSync } from './components/EventStyleSync'
import { TopbarSlotProvider } from './topbar-slot'
import '../styles/kiosk-profiles.css'

// The persistent kiosk chrome (responsive, fills the viewport). The active
// screen renders in the Outlet and can fill the topbar's right slot. (Idle /
// screensaver / keep-awake live in KioskDisplay, which wraps the whole app.)
export function KioskLayout() {
  return (
    <TopbarSlotProvider>
      <EventStyleSync />
      <div className="wf-kiosk wf">
        <Rail />
        <div className="kiosk-main">
          <OfflineBanner />
          <SyncHealthBanner />
          <Topbar />
          <Outlet />
        </div>
        <UpdateModal />
        <VoiceHud />
        <Timers />
      </div>
    </TopbarSlotProvider>
  )
}
