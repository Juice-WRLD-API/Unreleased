import { responsiveView } from '../lib/lazyView'

export default responsiveView(() => import('./PlaylistsView.desktop'), () => import('./PlaylistsView.mobile'))
