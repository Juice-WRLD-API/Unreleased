import { responsiveView } from '../lib/lazyView'

export default responsiveView(() => import('./ApiTrackerView.desktop'), () => import('./ApiTrackerView.mobile'))
