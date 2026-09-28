import { responsiveView } from '../lib/lazyView'

export default responsiveView(() => import('./TierlistView.desktop'), () => import('./TierlistView.mobile'))
