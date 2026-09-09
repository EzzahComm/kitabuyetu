-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260605111430  name: 065_iebc_subcounties_seed
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

INSERT INTO public.sub_counties (id, county_id, name)
SELECT gen_random_uuid(), c.id, v.name
FROM (VALUES
('001','Changamwe'),('001','Jomvu'),('001','Kisauni'),('001','Nyali'),('001','Likoni'),('001','Mvita'),('002','Msambweni'),('002','Lungalunga'),('002','Matuga'),('002','Kinango'),('003','Kilifi North'),('003','Kilifi South'),
('003','Kaloleni'),('003','Rabai'),('003','Ganze'),('003','Malindi'),('003','Magarini'),('004','Garsen'),('004','Galole'),('004','Bura'),('005','Lamu East'),('005','Lamu West'),('006','Taveta'),('006','Wundanyi'),
('006','Mwatate'),('006','Voi'),('007','Garissa Township'),('007','Balambala'),('007','Lagdera'),('007','Dadaab'),('007','Fafi'),('007','Ijara'),('008','Wajir North'),('008','Wajir East'),('008','Tarbaj'),('008','Wajir West'),
('008','Eldas'),('008','Wajir South'),('009','Mandera West'),('009','Banissa'),('009','Mandera North'),('009','Mandera South'),('009','Mandera East'),('009','Lafey'),('010','Moyale'),('010','North Horr'),('010','Saku'),('010','Laisamis'),
('011','Isiolo North'),('011','Isiolo South'),('012','Igembe South'),('012','Igembe Central'),('012','Igembe North'),('012','Tigania West'),('012','Tigania East'),('012','North Imenti'),('012','Buuri'),('012','Central Imenti'),('012','South Imenti'),('013','Maara'),
('013','Chuka/Igambang''om'),('013','Tharaka'),('014','Manyatta'),('014','Runyenjes'),('014','Mbeere South'),('014','Mbeere North'),('015','Mwingi North'),('015','Mwingi West'),('015','Mwingi Central'),('015','Kitui Rural'),('015','Kitui Central'),('015','Kitui East'),
('015','Kitui South'),('016','Masinga'),('016','Yatta'),('016','Kangundo'),('016','Matungulu'),('016','Kathiani'),('016','Mavoko'),('016','Machakos Town'),('016','Mwala'),('017','Mbooni'),('017','Kilome'),('017','Kaiti'),
('017','Makueni'),('017','Kibwezi West'),('017','Kibwezi East'),('018','Kinangop'),('018','Kipipiri'),('018','Ol Kalou'),('018','Ol Jorok'),('018','Ndaragwa'),('019','Tetu'),('019','Kieni'),('019','Mathira'),('019','Othaya'),
('019','Mukurweini'),('019','Nyeri Town'),('020','Mwea'),('020','Gichugu'),('020','Ndia'),('020','Kirinyaga Central'),('021','Kangema'),('021','Mathioya'),('021','Kiharu'),('021','Kigumo'),('021','Maragwa'),('021','Kandara'),
('021','Gatanga'),('022','Gatundu South'),('022','Gatundu North'),('022','Juja'),('022','Thika Town'),('022','Ruiru'),('022','Githunguri'),('022','Kiambu'),('022','Kiambaa'),('022','Kabete'),('022','Kikuyu'),('022','Limuru'),
('022','Lari'),('023','Turkana North'),('023','Turkana West'),('023','Turkana Central'),('023','Loima'),('023','Turkana South'),('023','Turkana East'),('024','Kapenguria'),('024','Sigor'),('024','Kacheliba'),('024','Pokot South'),('025','Samburu West'),
('025','Samburu North'),('025','Samburu East'),('026','Kwanza'),('026','Endebess'),('026','Saboti'),('026','Kiminini'),('026','Cherangany'),('027','Soy'),('027','Turbo'),('027','Moiben'),('027','Ainabkoi'),('027','Kapseret'),
('027','Kesses'),('028','Marakwet East'),('028','Marakwet West'),('028','Keiyo North'),('028','Keiyo South'),('029','Tinderet'),('029','Aldai'),('029','Nandi Hills'),('029','Chesumei'),('029','Emgwen'),('029','Mosop'),('030','Tiaty'),
('030','Baringo North'),('030','Baringo Central'),('030','Baringo South'),('030','Mogotio'),('030','Eldama Ravine'),('031','Laikipia West'),('031','Laikipia East'),('031','Laikipia North'),('032','Molo'),('032','Njoro'),('032','Naivasha'),('032','Gilgil'),
('032','Kuresoi South'),('032','Kuresoi North'),('032','Subukia'),('032','Rongai'),('032','Bahati'),('032','Nakuru Town West'),('032','Nakuru Town East'),('033','Kilgoris'),('033','Emurua Dikirr'),('033','Narok North'),('033','Narok East'),('033','Narok South'),
('033','Narok West'),('034','Kajiado North'),('034','Kajiado Central'),('034','Kajiado East'),('034','Kajiado West'),('034','Kajiado South'),('035','Kipkelion East'),('035','Kipkelion West'),('035','Ainamoi'),('035','Bureti'),('035','Belgut'),('035','Sigowet/Soin'),
('036','Sotik'),('036','Chepalungu'),('036','Bomet East'),('036','Bomet Central'),('036','Konoin'),('037','Lugari'),('037','Likuyani'),('037','Malava'),('037','Lurambi'),('037','Navakholo'),('037','Mumias West'),('037','Mumias East'),
('037','Matungu'),('037','Butere'),('037','Khwisero'),('037','Shinyalu'),('037','Ikolomani'),('038','Vihiga'),('038','Sabatia'),('038','Hamisi'),('038','Luanda'),('038','Emuhaya'),('039','Mt.elgon'),('039','Sirisia'),
('039','Kabuchai'),('039','Bumula'),('039','Kanduyi'),('039','Webuye East'),('039','Webuye West'),('039','Kimilili'),('039','Tongaren'),('040','Teso North'),('040','Teso South'),('040','Nambale'),('040','Matayos'),('040','Butula'),
('040','Funyula'),('040','Budalangi'),('041','Ugenya'),('041','Alego Usonga'),('041','Gem'),('041','Bondo'),('041','Rarieda'),('042','Kisumu East'),('042','Kisumu West'),('042','Kisumu Central'),('042','Seme'),('042','Nyando'),
('042','Muhoroni'),('042','Nyakach'),('043','Kasipul'),('043','Kabondo Kasipul'),('043','Karachuonyo'),('043','Rangwe'),('043','Homa Bay Town'),('043','Ndhiwa'),('043','Mbita'),('043','Suba'),('044','Rongo'),('044','Awendo'),
('044','Suna East'),('044','Suna West'),('044','Uriri'),('044','Nyatike'),('044','Kuria West'),('044','Kuria East'),('045','Bonchari'),('045','South Mugirango'),('045','Bomachoge Borabu'),('045','Bobasi'),('045','Bomachoge Chache'),('045','Nyaribari Masaba'),
('045','Nyaribari Chache'),('045','Kitutu Chache North'),('045','Kitutu Chache South'),('046','Kitutu Masaba'),('046','West Mugirango'),('046','North Mugirango'),('046','Borabu'),('047','Westlands'),('047','Dagoretti North'),('047','Dagoretti South'),('047','Langata'),('047','Kibra'),
('047','Roysambu'),('047','Kasarani'),('047','Ruaraka'),('047','Embakasi South'),('047','Embakasi North'),('047','Embakasi Central'),('047','Embakasi East'),('047','Embakasi West'),('047','Makadara'),('047','Kamukunji'),('047','Starehe'),('047','Mathare'),
('015','Kitui West'),('041','Ugunja')
) AS v(ccode, name)
JOIN public.counties c ON c.code = v.ccode
ON CONFLICT (county_id, name) DO NOTHING;
