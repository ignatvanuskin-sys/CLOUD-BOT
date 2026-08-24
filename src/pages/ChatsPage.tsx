import { EmptyState } from '../components/ui';
export default function ChatsPage(){return <div className="page chats-page"><div className="page-heading"><span className="eyebrow">Сообщения</span><h1>Чаты</h1><p>Диалоги с продавцами и поддержкой появятся здесь.</p></div><EmptyState title="Пока нет диалогов" text="Когда появятся сообщения от продавцов или покупателей, они появятся здесь." actionLabel="Перейти в каталог" action={()=>location.assign('/search')} /></div>}
export { ChatsPage };
