import { responsiveView } from '../lib/lazyView'

// Statistics has a shell per breakpoint: the same data (hooks/useStatisticsData)
// and the same row/bar building blocks (lib/statisticsShared), laid out as a
// phone screen or a desktop dashboard - same split as Home (HomeView.tsx).
export default responsiveView(() => import('./StatisticsView.desktop'), () => import('./StatisticsView.mobile'))
