import { responsiveView } from '../lib/lazyView'

// Home has a shell per breakpoint: the same sections and the same data
// (hooks/useHomeData), laid out as phone rails or as a desktop dashboard.
export default responsiveView(() => import('./HomeView.desktop'), () => import('./HomeView.mobile'))
