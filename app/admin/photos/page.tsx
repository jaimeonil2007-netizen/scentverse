import AdminPhotos from '../../../components/AdminPhotos';

export const dynamic='force-dynamic';

export const metadata={
 title:'Photo review · SCENTVERSE',
 robots:{index:false,follow:false}
};

export default function AdminPhotosPage(){
 return <><header><div className="wrap nav"><a className="logo" href="/">SCENTVERSE</a><a href="/">Back to catalog</a></div></header><AdminPhotos/></>;
}
