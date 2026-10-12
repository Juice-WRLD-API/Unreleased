import { responsiveView } from '../lib/lazyView'

export default responsiveView(() => import('./WrldView.desktop'), () => import('./WrldView.mobile'))
