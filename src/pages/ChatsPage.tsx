import { EmptyState } from '../components/ui';
export default function ChatsPage(){return <div className="page chats-page"><div className="page-heading"><span className="eyebrow">Сообщения</span><h1>Чаты</h1><p>Диалоги с продавцами и поддержкой появятся здесь.</p></div><EmptyState title="Здесь появятся ваши диалоги" text="Откройте товар или обратитесь в поддержку — доступные разговоры будут собраны в этом разделе." actionLabel="Открыть каталог" action={()=>location.assign('/search')} /></div>}
export { ChatsPage };
