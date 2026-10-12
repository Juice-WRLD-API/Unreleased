import { responsiveView } from '../lib/lazyView'

export default responsiveView(() => import('./Settings.desktop'), () => import('./Settings.mobile'))
