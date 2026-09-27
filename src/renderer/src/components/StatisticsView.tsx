import { useIsMobile } from '../hooks/useIsMobile'
import StatisticsViewMobile from './StatisticsView.mobile'
import StatisticsViewDesktop from './StatisticsView.desktop'

// Statistics has a shell per breakpoint: the same data (hooks/useStatisticsData)
// and the same row/bar building blocks (lib/statisticsShared), laid out as a
// phone screen or a desktop dashboard - same split as Home (HomeView.tsx).
export default function StatisticsView(): JSX.Element {
  const isMobile = useIsMobile()
  return isMobile ? <StatisticsViewMobile /> : <StatisticsViewDesktop />
}
