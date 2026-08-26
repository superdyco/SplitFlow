import 'package:splitflow/domain/place_search.dart';
import 'package:test/test.dart';

void main() {
  group('newSessionToken', () {
    test('是 UUID v4 的形狀', () {
      final token = newSessionToken();
      expect(
        token,
        matches(
          RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
        ),
      );
    });

    test('每次都不一樣', () {
      final tokens = {for (var i = 0; i < 50; i++) newSessionToken()};
      expect(tokens.length, 50);
    });
  });

  group('autocompleteBody', () {
    test('沒有偏好時不放 locationBias —— 請求要跟以前一模一樣', () {
      final body = autocompleteBody(input: '拉麵', sessionToken: 't1');
      expect(body.containsKey('locationBias'), isFalse);
      expect(body, {
        'input': '拉麵',
        'sessionToken': 't1',
        'languageCode': 'zh-TW',
      });
    });

    test('有偏好時原樣帶進去', () {
      final body = autocompleteBody(
        input: '拉麵',
        sessionToken: 't1',
        bias: {'circle': 'x'},
      );
      expect(body['locationBias'], {'circle': 'x'});
    });

    test('前後空白會去掉 —— 空白開頭的查詢會回傳不相干的東西', () {
      expect(autocompleteBody(input: '  拉麵  ', sessionToken: 't')['input'],
          '拉麵');
    });
  });

  group('parseSuggestions', () {
    test('挑出地點建議', () {
      final list = parseSuggestions({
        'suggestions': [
          {
            'placePrediction': {
              'placeId': 'p1',
              'structuredFormat': {
                'mainText': {'text': '一蘭拉麵'},
                'secondaryText': {'text': '東京都新宿區'},
              },
            }
          }
        ]
      });
      expect(list.length, 1);
      expect(list.first.placeId, 'p1');
      expect(list.first.primary, '一蘭拉麵');
      expect(list.first.secondary, '東京都新宿區');
    });

    test('沒有 structuredFormat 時退回整串文字', () {
      final list = parseSuggestions({
        'suggestions': [
          {
            'placePrediction': {
              'placeId': 'p1',
              'text': {'text': '一蘭拉麵 東京都新宿區'},
            }
          }
        ]
      });
      expect(list.single.primary, '一蘭拉麵 東京都新宿區');
      expect(list.single.secondary, '');
    });

    test('查詢建議不是地點，丟掉', () {
      final list = parseSuggestions({
        'suggestions': [
          {
            'queryPrediction': {
              'text': {'text': '拉麵'}
            }
          }
        ]
      });
      expect(list, isEmpty);
    });

    test('沒有 placeId 的選了也拿不到詳細資料，丟掉', () {
      final list = parseSuggestions({
        'suggestions': [
          {
            'placePrediction': {
              'structuredFormat': {
                'mainText': {'text': '某處'}
              }
            }
          }
        ]
      });
      expect(list, isEmpty);
    });

    test('空的或形狀不對的回應都是空清單，不是例外', () {
      expect(parseSuggestions({}), isEmpty);
      expect(parseSuggestions({'suggestions': null}), isEmpty);
      expect(parseSuggestions({'suggestions': 'nope'}), isEmpty);
      expect(parseSuggestions({'suggestions': []}), isEmpty);
    });
  });

  group('parsePlaceDetails', () {
    test('完整的回應', () {
      final place = parsePlaceDetails({
        'id': 'p1',
        'displayName': {'text': '一蘭拉麵'},
        'formattedAddress': '東京都新宿區',
        'location': {'latitude': 35.69, 'longitude': 139.70},
      }, 'fallback');

      expect(place.name, '一蘭拉麵');
      expect(place.address, '東京都新宿區');
      expect(place.lat, 35.69);
      expect(place.lng, 139.70);
      expect(place.placeId, 'p1');
    });

    test('回應沒帶 id 就補上查詢用的那一個 —— 那是唯一能再查一次的鑰匙', () {
      final place = parsePlaceDetails({
        'displayName': {'text': '某處'}
      }, 'fallback');
      expect(place.placeId, 'fallback');
    });

    test('沒有座標時是 null，不是 0 —— 0,0 是幾內亞灣上的一個點', () {
      final place = parsePlaceDetails({
        'displayName': {'text': '某處'}
      }, 'p1');
      expect(place.lat, isNull);
      expect(place.lng, isNull);
      expect(place.address, isNull);
    });

    test('整數座標也讀得出來 —— JSON 的 0 不會是 double', () {
      final place = parsePlaceDetails({
        'displayName': {'text': '赤道上'},
        'location': {'latitude': 0, 'longitude': 0},
      }, 'p1');
      expect(place.lat, 0.0);
      expect(place.lng, 0.0);
    });
  });

  group('placeErrorMessage', () {
    test('用 Google 給的訊息 —— 它比 HTTP 403 有用得多', () {
      expect(
        placeErrorMessage({
          'error': {'message': 'API key not valid'}
        }, 403),
        'API key not valid',
      );
    });

    test('挖不出訊息就退回狀態碼', () {
      expect(placeErrorMessage(null, 500), '地點服務回應 500');
      expect(placeErrorMessage({}, 500), '地點服務回應 500');
      expect(placeErrorMessage({'error': 'oops'}, 500), '地點服務回應 500');
    });
  });

  group('placeErrorHint', () {
    test('金鑰被擋時第一句要先講「你還是可以繼續」', () {
      final hint = placeErrorHint(
        'Requests from referer <empty> are blocked.',
        status: 403,
      );
      expect(hint.split('\n').first, contains('直接打地點名字'));
    });

    test('Google 的原話留著 —— 沒有它就修不動設定', () {
      final hint = placeErrorHint('API key not valid', status: 400);
      expect(hint, contains('API key not valid'));
    });

    test('referer 被擋，即使狀態碼不是 403 也認得出來', () {
      final hint = placeErrorHint('Requests from referer are blocked.');
      expect(hint, contains('直接打地點名字'));
    });

    test('跟金鑰無關的錯誤原樣傳回去，不要亂給建議', () {
      expect(
        placeErrorHint('地點服務回應 500', status: 500),
        '地點服務回應 500',
      );
    });
  });
}
