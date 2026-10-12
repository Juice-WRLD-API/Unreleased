import { responsiveView } from '../lib/lazyView'

export default responsiveView(() => import('./HeardleView.desktop'), () => import('./HeardleView.mobile'))
