import {useCallback,useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {motion} from 'framer-motion';
import {Check,ExternalLink,Heart,PackageCheck,ShieldCheck,Sparkles} from 'lucide-react';
import {useNavigate,useParams} from 'react-router-dom';
import {getProduct} from '../api/queries';
import {Badge,Button,Card,ErrorState,PageLoader} from '../components/ui';
import {useCheckout} from '../features/checkout';
import {useAppFavorites,useSession} from '../providers/AppProviders';
import {formatStars} from '../utils/cn';
import {haptic,showPopup,telegram} from '../services/telegram';
import {useTelegramMainButton,useTelegramSecondaryButton} from '../hooks/useTelegramButtons';

export default function ProductPage(){
 const{slug=''}=useParams(),nav=useNavigate(),auth=useSession(),favorites=useAppFavorites();
 const query=useQuery({queryKey:['product',slug],queryFn:({signal})=>getProduct(slug,signal)});
 const[planId,setPlanId]=useState(''),checkout=useCheckout();
 useEffect(()=>{if(query.data?.plans[0]&&!planId)setPlanId(query.data.plans[0].id)},[query.data,planId]);
 const buy=useCallback(async()=>{if(!planId)return;if(!auth.authenticated){await showPopup('Вход через Telegram','Откройте Mini App из бота, чтобы безопасно оплатить покупку.');return}const result=await checkout.mutateAsync(planId);if(result.status==='fulfilled'||result.status==='processing')nav(`/payments?order=${encodeURIComponent(result.orderId)}`)},[planId,auth.authenticated,checkout,nav]);
 const toggleFavorite=useCallback(()=>{const id=query.data?.product.id;if(id){favorites.toggle(id);haptic.success()}},[query.data,favorites]);
 useTelegramMainButton({text:'Купить за Stars',visible:Boolean(query.data&&planId),loading:checkout.isPending,disabled:!planId,onClick:buy});
 useTelegramSecondaryButton({text:'В избранное',visible:Boolean(query.data),onClick:toggleFavorite});
 if(query.isLoading)return <PageLoader/>;if(query.error)return <ErrorState error={query.error} retry={()=>query.refetch()}/>;if(!query.data)return null;
 const{product,plans}=query.data,plan=plans.find(p=>p.id===planId),liked=favorites.ids.includes(product.id);
 return <div className="page product-page"><section className="product-hero"><div className="product-cover">{product.preview&&<img src={product.preview} alt="" loading="lazy" decoding="async"/>}<motion.div animate={{rotate:[-3,3,-3],y:[0,-6,0]}} transition={{duration:6,repeat:Infinity,ease:'easeInOut'}}><PackageCheck/></motion.div><Badge>{product.type.replace('_',' ')}</Badge></div><button className={liked?'favorite-fab liked':'favorite-fab'} aria-label="Избранное" onClick={toggleFavorite}><Heart fill={liked?'currentColor':'none'}/></button><span className="eyebrow">{product.category} · v{product.version}</span><h1>{product.title}</h1><p className="lead">{product.result}</p>{product.demo_url&&<Button className="soft" onClick={()=>product.demo_url&&telegram?.openLink?.(product.demo_url)}><ExternalLink/>Открыть демо</Button>}</section>
 {product.description&&<Card className="detail-card"><span className="eyebrow">О продукте</span><p>{product.description}</p>{product.stack&&<div className="tech-list">{product.stack.split(',').map(x=><span key={x}>{x.trim()}</span>)}</div>}</Card>}
 <section><div className="section-title"><div><span className="eyebrow">Лицензия</span><h2>Выберите формат</h2></div></div><div className="plan-list">{plans.map(p=><motion.button layout key={p.id} className={planId===p.id?'plan-card active':'plan-card'} onClick={()=>{setPlanId(p.id);haptic.select()}}><span className="plan-check">{planId===p.id&&<Check/>}</span><div><b>{p.name}</b><small>{p.projects} проект · поддержка {p.support_days} дней · обновления {p.updates_days} дней</small></div><strong>{formatStars(p.price_xtr)}</strong></motion.button>)}</div></section>
 {plan&&<Card className="license-summary"><ShieldCheck/><div><b>Защищённая покупка</b><span>{plan.commercial?'Коммерческое использование включено. ':''}{plan.terms||'Условия лицензии фиксируются в заказе.'}</span></div></Card>}
 <div className="checkout-dock"><div><small>Итого</small><b>{formatStars(plan?.price_xtr)}</b></div><Button className="primary" disabled={!planId||checkout.isPending} onClick={buy}>{checkout.isPending?<><Sparkles className="animate-spin"/>Открываем…</>:<>Купить за Stars</>}</Button></div></div>
}
