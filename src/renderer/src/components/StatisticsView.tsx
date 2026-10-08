import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import { preloadView } from '../lib/lazyViews'

// Statistics is a tab of the Tracker (see StatisticsPanel.desktop/.mobile), not
// a page of its own. This stays only so existing entry points - Home's hero
// stats, the terminal and the /statistics URL - keep working: it hands off to
// the Tracker with its Statistics tab preselected.
function StatisticsView(): null {
  useEffect(() => {
    const s = useStore.getState()
    s.setApiTrackerTab('statistics')
    s.setActiveView('api-tracker')
  }, [])
  return null
}

StatisticsView.preload = (): Promise<unknown> => Promise.resolve(preloadView('api-tracker'))

export default StatisticsView
