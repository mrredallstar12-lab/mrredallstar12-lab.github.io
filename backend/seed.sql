INSERT OR IGNORE INTO creature_state (id, designation, hunger, mood, stage, modifiers_json, containment_sensitivity)
VALUES (1, 'Specimen 0-FEED', 66, 'waiting near the vending machine', 1, '["paper teeth","coin eyes"]', 1);

INSERT OR IGNORE INTO objectives (id, title, description, objective_type, target_value, current_value, reward_json)
VALUES
  ('close-4000-popups', 'Close 4,000 fake popups', 'Every rectangle buried lowers popup humidity for one day.', 'popup_close', 4000, 0, '{"currency":["Popup Bucks",4],"item":"Rectangle Rain Check"}'),
  ('tune-radio-666', 'Tune the radio 666 times', 'The shared dial wants proof that static has listeners.', 'radio_tune', 666, 0, '{"item":"Community Static Needle"}'),
  ('feed-creature-1000', 'Feed the Archive Creature 1,000 pieces of junk', 'It is not starving. It is negotiating.', 'creature_feed', 1000, 0, '{"item":"Creature Thank-You Receipt"}');

INSERT OR IGNORE INTO daily_signals (date_key, transmission, artifact, rumor, corrupted_message, reward_json, weather_effect, room_key)
VALUES
  ('fallback', 'The signal repeats: KEEP THE PUBLIC ARCHIVE LOUD.', 'Static Coin', 'The basement clock is five minutes behind 1998.', 'CASE 000 should not be completed.', '{"currency":["Static Coins",3],"item":"Shared Signal Stub"}', 'pixel-fog', 'none');

INSERT OR IGNORE INTO archive_conditions (condition_key, label, detail)
VALUES ('stable', 'Stable', 'The public archive is loud, colorful, and behaving within expected limits.');

INSERT OR IGNORE INTO archive_weather (weather_key, label, detail, intensity)
VALUES ('clear-signal', 'Clear signal', 'No shared weather is currently bending the buttons.', 1);

INSERT OR IGNORE INTO case_files (id, subject_name, fictional_age, fictional_location, intake_date, status, assigned_employee, summary, restricted, coherence_weight, data_json)
VALUES
  ('case-017', 'Elian Rook', '29', 'Barrow Glass Exchange, State of North Mercer', '1987-04-16', 'open; contradictory witness chain', 'Archivist L. Noone', 'A projectionist vanished after cataloging a film reel that contained his next three interviews.', 0, 1, '{"possessions":["blue raincoat","ticket stub 04-17","wet cassette"],"connections":["Radio Static Sample","CH 404","Popup Graveyard"],"notice":"Fictional case. No real agency or person is represented."}'),
  ('case-031', 'Nessa Quill', '17', 'Juniper Switchboard School, South Annor', '2004-11-03', 'records disagree whether she attended', 'Employee 18-B', 'A student was remembered by classmates only after her locker was emptied by someone using Mara Vale’s name.', 0, 2, '{"possessions":["green library card","button with no holes","folded zero-percent coupon"],"connections":["Coupon Dust","Archive Map","Fake Inbox"],"notice":"Fictional case. No real agency or person is represented."}'),
  ('case-044', 'Milo Venn', '42', 'Civic Aquarium Annex, Old Canto', '1999-08-22', 'photographic subject replaced', 'Clerk Unit 9', 'A maintenance worker disappeared from group photographs one feature at a time.', 0, 2, '{"possessions":["aquarium key tag","rubber boot","employee badge without number"],"connections":["Pixel Aquarium","VDO Spark","Employee Terminal"],"notice":"Fictional case. No real agency or person is represented."}'),
  ('case-000', 'Mara Vale', 'unverified', 'location must not stabilize', '0000-00-00', 'restricted; containment active', 'Records Clerk', 'Mara Vale may never have existed. The Archive prevents her location and history from becoming real.', 1, 47, '{"iteration":47,"warning":"DO NOT ATTEMPT TO COMPLETE THE PERSON.","memo":"CASE 000 IS NOT AN ATTEMPT TO LOCATE MARA VALE. CASE 000 IS AN ATTEMPT TO PREVENT THE LOCATION FROM BECOMING REAL.","notice":"Fictional horror record. No real missing-person content."}');

INSERT OR IGNORE INTO case_fragments (id, case_id, stage_required, title, body, data_json)
VALUES
  ('000-memo', 'case-000', 0, 'Containment Memo', 'CASE 000 IS NOT AN ATTEMPT TO LOCATE MARA VALE. CASE 000 IS AN ATTEMPT TO PREVENT THE LOCATION FROM BECOMING REAL.', '{"tone":"administrative"}'),
  ('000-iteration-47', 'case-000', 1, 'Iteration 47', 'The current file is Iteration 47. Previous versions were completed, named, and then removed from the index.', '{"reveal":5}'),
  ('000-portrait-gap', 'case-000', 2, 'Employee Photograph Gap', 'A damaged staff photograph contains a person-shaped removal beside the records cabinet.', '{"futureCaption":"THANK YOU. I COULD NOT REMEMBER WHAT I LOOKED LIKE."}');
