import { responsiveView } from '../lib/lazyView'

export default responsiveView(() => import('./StatsView.desktop'), () => import('./StatsView.mobile'))
