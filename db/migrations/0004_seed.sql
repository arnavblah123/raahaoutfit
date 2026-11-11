-- Seed data: attribute vocabulary, colour families and default settings.
-- Generated once from the product brief; edit values in the admin Vocabulary page afterwards.

insert into attribute_groups (key, label, free_text, sort) values
  ('garment_type', 'Garment type', false, 0),
  ('colour', 'Colour', false, 1),
  ('tone', 'Tone', false, 2),
  ('embellishment', 'Embroidery and embellishment', false, 3),
  ('print_weave', 'Print and weave', false, 4),
  ('fabric', 'Fabric', false, 5),
  ('motif', 'Motif', false, 6),
  ('work_placement', 'Work placement', false, 7),
  ('density', 'Work density', false, 8),
  ('finish', 'Finish', false, 9),
  ('silhouette', 'Silhouette', true, 10),
  ('neckline', 'Neckline', true, 11),
  ('sleeve_style', 'Sleeve style', true, 12),
  ('blouse_style', 'Blouse style', true, 13),
  ('border_type', 'Border type', true, 14),
  ('dupatta_colour', 'Dupatta colour', true, 15),
  ('dupatta_drape', 'Dupatta drape', true, 16)
on conflict (key) do nothing;

insert into colour_families (key, label, neighbour_keys, sort) values
  ('reds_pinks', 'Reds and pinks', array['oranges_yellows', 'purples'], 0),
  ('oranges_yellows', 'Oranges and yellows', array['reds_pinks', 'greens', 'neutrals_metallics'], 1),
  ('greens', 'Greens', array['oranges_yellows', 'blues'], 2),
  ('blues', 'Blues', array['greens', 'purples'], 3),
  ('purples', 'Purples', array['blues', 'reds_pinks'], 4),
  ('neutrals_metallics', 'Neutrals and metallics', array['oranges_yellows'], 5)
on conflict (key) do nothing;

insert into attribute_values (group_id, value, colour_family_id, swatch_hex, sort)
select g.id, v.value, f.id, v.hex, v.sort
from (values
  ('red', '#D0202A', 'reds_pinks', 0),
  ('deep red', '#9B111E', 'reds_pinks', 1),
  ('maroon', '#800000', 'reds_pinks', 2),
  ('wine', '#722F37', 'reds_pinks', 3),
  ('burgundy', '#800020', 'reds_pinks', 4),
  ('crimson', '#DC143C', 'reds_pinks', 5),
  ('rust', '#B7410E', 'reds_pinks', 6),
  ('coral', '#FF7F50', 'reds_pinks', 7),
  ('peach', '#FFCBA4', 'reds_pinks', 8),
  ('blush', '#F4C2C2', 'reds_pinks', 9),
  ('baby pink', '#F8C8DC', 'reds_pinks', 10),
  ('rose', '#E8909C', 'reds_pinks', 11),
  ('hot pink', '#FF4FA3', 'reds_pinks', 12),
  ('rani pink', '#D6247A', 'reds_pinks', 13),
  ('magenta', '#C2187A', 'reds_pinks', 14),
  ('fuchsia', '#E0218A', 'reds_pinks', 15),
  ('onion pink', '#C9838F', 'reds_pinks', 16),
  ('orchid', '#DA70D6', 'reds_pinks', 17),
  ('orange', '#F58220', 'oranges_yellows', 18),
  ('burnt orange', '#CC5500', 'oranges_yellows', 19),
  ('saffron', '#F4A300', 'oranges_yellows', 20),
  ('mustard', '#D4A017', 'oranges_yellows', 21),
  ('turmeric yellow', '#F2C200', 'oranges_yellows', 22),
  ('lemon', '#FFF176', 'oranges_yellows', 23),
  ('gold', '#D4AF37', 'oranges_yellows', 24),
  ('champagne', '#F1DDB8', 'oranges_yellows', 25),
  ('mint', '#B5EAD7', 'greens', 26),
  ('pista', '#C5DCA0', 'greens', 27),
  ('sage', '#A3B18A', 'greens', 28),
  ('olive', '#708238', 'greens', 29),
  ('mehendi green', '#6B7A1E', 'greens', 30),
  ('parrot green', '#4CBB17', 'greens', 31),
  ('lime', '#BFD833', 'greens', 32),
  ('emerald', '#1E9B6B', 'greens', 33),
  ('bottle green', '#0B5D3B', 'greens', 34),
  ('sea green', '#2E8B77', 'greens', 35),
  ('teal', '#008080', 'greens', 36),
  ('sky blue', '#87CEEB', 'blues', 37),
  ('powder blue', '#B6D0E2', 'blues', 38),
  ('ice blue', '#D6ECF3', 'blues', 39),
  ('dust blue', '#8FA9BF', 'blues', 40),
  ('aqua', '#7FDBDA', 'blues', 41),
  ('turquoise', '#30D5C8', 'blues', 42),
  ('firozi', '#12B5CB', 'blues', 43),
  ('royal blue', '#2447B5', 'blues', 44),
  ('cobalt', '#0047AB', 'blues', 45),
  ('navy', '#14213D', 'blues', 46),
  ('peacock blue', '#005F73', 'blues', 47),
  ('indigo', '#3F3D99', 'blues', 48),
  ('lavender', '#C9B8E8', 'purples', 49),
  ('lilac', '#C8A2C8', 'purples', 50),
  ('mauve', '#B784A7', 'purples', 51),
  ('purple', '#7B2D8E', 'purples', 52),
  ('violet', '#7F3FBF', 'purples', 53),
  ('plum', '#7A2E5E', 'purples', 54),
  ('aubergine', '#472C4C', 'purples', 55),
  ('white', '#FFFFFF', 'neutrals_metallics', 56),
  ('ivory', '#FFFDF0', 'neutrals_metallics', 57),
  ('cream', '#FFF4D6', 'neutrals_metallics', 58),
  ('beige', '#E6D2B5', 'neutrals_metallics', 59),
  ('nude', '#E3BC9A', 'neutrals_metallics', 60),
  ('brown', '#7B4B2A', 'neutrals_metallics', 61),
  ('coffee', '#4B3621', 'neutrals_metallics', 62),
  ('grey', '#9E9E9E', 'neutrals_metallics', 63),
  ('charcoal', '#36454F', 'neutrals_metallics', 64),
  ('black', '#111111', 'neutrals_metallics', 65),
  ('silver', '#C0C0C0', 'neutrals_metallics', 66),
  ('rose gold', '#B76E79', 'neutrals_metallics', 67),
  ('copper', '#B87333', 'neutrals_metallics', 68),
  ('bronze', '#9C6B30', 'neutrals_metallics', 69),
  ('metallic', '#A8A9AD', 'neutrals_metallics', 70)
) as v(value, hex, family, sort)
join attribute_groups g on g.key = 'colour'
join colour_families f on f.key = v.family
on conflict do nothing;

insert into attribute_values (group_id, value, sort)
select g.id, v.value, v.sort from (values
  ('lehenga choli', 0),
  ('bridal lehenga', 1),
  ('jacket lehenga', 2),
  ('crush lehenga', 3),
  ('saree', 4),
  ('drape saree', 5),
  ('pre-draped saree', 6),
  ('half saree', 7),
  ('anarkali', 8),
  ('floor-length gown', 9),
  ('indo-western gown', 10),
  ('sharara set', 11),
  ('gharara set', 12),
  ('palazzo set', 13),
  ('salwar kameez', 14),
  ('farshi salwar set', 15),
  ('churidar set', 16),
  ('kurta set', 17),
  ('choga set', 18),
  ('cape set', 19),
  ('drape skirt set', 20),
  ('blazer set', 21),
  ('dhoti set', 22),
  ('co-ord set', 23),
  ('kaftan', 24),
  ('skirt and top', 25),
  ('angrakha', 26)
) as v(value, sort) join attribute_groups g on g.key = 'garment_type'
on conflict do nothing;

insert into attribute_values (group_id, value, sort)
select g.id, v.value, v.sort from (values
  ('pastel', 0),
  ('bright', 1),
  ('deep', 2),
  ('metallic', 3),
  ('multicolour', 4),
  ('ombre', 5)
) as v(value, sort) join attribute_groups g on g.key = 'tone'
on conflict do nothing;

insert into attribute_values (group_id, value, sort)
select g.id, v.value, v.sort from (values
  ('zari', 0),
  ('zardozi', 1),
  ('dabka', 2),
  ('aari', 3),
  ('resham thread', 4),
  ('sequin', 5),
  ('mirror', 6),
  ('gota patti', 7),
  ('kundan', 8),
  ('stone', 9),
  ('crystal', 10),
  ('pearl (moti)', 11),
  ('mother of pearl', 12),
  ('cutdana', 13),
  ('beads', 14),
  ('poth', 15),
  ('salli', 16),
  ('shell', 17),
  ('feather', 18),
  ('chikankari (Lucknowi)', 19),
  ('phulkari', 20),
  ('kantha', 21),
  ('Kashmiri', 22),
  ('Parsi gara', 23),
  ('applique', 24),
  ('patch work', 25),
  ('cutwork', 26),
  ('lace', 27),
  ('tassels', 28)
) as v(value, sort) join attribute_groups g on g.key = 'embellishment'
on conflict do nothing;

insert into attribute_values (group_id, value, sort)
select g.id, v.value, v.sort from (values
  ('bandhani', 0),
  ('leheriya', 1),
  ('ikat', 2),
  ('patola', 3),
  ('block print', 4),
  ('kalamkari', 5),
  ('ajrakh', 6),
  ('digital print', 7),
  ('position print', 8),
  ('foil print', 9),
  ('Banarasi brocade', 10),
  ('Kanjeevaram', 11),
  ('Paithani', 12),
  ('minakari weave', 13),
  ('jamdani', 14),
  ('Pochampally', 15)
) as v(value, sort) join attribute_groups g on g.key = 'print_weave'
on conflict do nothing;

insert into attribute_values (group_id, value, sort)
select g.id, v.value, v.sort from (values
  ('raw silk', 0),
  ('Banarasi silk', 1),
  ('Kanjeevaram silk', 2),
  ('mulberry silk', 3),
  ('gaji silk', 4),
  ('dola silk', 5),
  ('modal silk', 6),
  ('cotton silk', 7),
  ('crepe silk', 8),
  ('tussar', 9),
  ('dupion', 10),
  ('art silk', 11),
  ('satin', 12),
  ('crepe', 13),
  ('georgette', 14),
  ('khaddi georgette', 15),
  ('chiffon', 16),
  ('chinon', 17),
  ('net', 18),
  ('tulle', 19),
  ('organza', 20),
  ('tissue', 21),
  ('velvet', 22),
  ('cotton', 23),
  ('mulmul', 24),
  ('muslin', 25),
  ('linen', 26),
  ('chanderi', 27),
  ('Maheshwari', 28),
  ('kota doria', 29),
  ('brocade', 30),
  ('jacquard', 31),
  ('taffeta', 32),
  ('viscose', 33),
  ('lycra', 34),
  ('crushed', 35)
) as v(value, sort) join attribute_groups g on g.key = 'fabric'
on conflict do nothing;

insert into attribute_values (group_id, value, sort)
select g.id, v.value, v.sort from (values
  ('floral', 0),
  ('paisley', 1),
  ('peacock', 2),
  ('elephant', 3),
  ('jaal', 4),
  ('buti', 5),
  ('geometric', 6),
  ('stripes', 7),
  ('checks', 8),
  ('abstract', 9),
  ('plain', 10)
) as v(value, sort) join attribute_groups g on g.key = 'motif'
on conflict do nothing;

insert into attribute_values (group_id, value, sort)
select g.id, v.value, v.sort from (values
  ('all-over', 0),
  ('border', 1),
  ('yoke', 2),
  ('neckline', 3),
  ('scattered', 4)
) as v(value, sort) join attribute_groups g on g.key = 'work_placement'
on conflict do nothing;

insert into attribute_values (group_id, value, sort)
select g.id, v.value, v.sort from (values
  ('heavy', 0),
  ('medium', 1),
  ('light', 2)
) as v(value, sort) join attribute_groups g on g.key = 'density'
on conflict do nothing;

insert into attribute_values (group_id, value, sort)
select g.id, v.value, v.sort from (values
  ('matte', 0),
  ('sheen', 1),
  ('shimmer', 2),
  ('metallic', 3)
) as v(value, sort) join attribute_groups g on g.key = 'finish'
on conflict do nothing;

insert into settings (key, value) values
  ('shortlist_top_k', '5'::jsonb),
  ('judge_threshold', '0.6'::jsonb),
  ('max_extra_rounds', '2'::jsonb),
  ('uploads_per_guest_per_day', '12'::jsonb),
  ('uploads_per_wedding_per_day', '400'::jsonb),
  ('max_outfits_per_function', '3'::jsonb),
  ('vocab_auto_promote_after', '5'::jsonb),
  ('similar_styles_count', '4'::jsonb),
  ('threshold_target_recall', '0.98'::jsonb),
  ('judge_on_label', 'true'::jsonb),
  ('raaha_feed_url', '"https://raahabyarchanabansal.in/wp-json/wc/store/v1/products"'::jsonb),
  ('raaha_nightly_cost_cap_usd', '1'::jsonb),
  ('default_import_cost_cap_usd', '2'::jsonb)
on conflict (key) do nothing;
