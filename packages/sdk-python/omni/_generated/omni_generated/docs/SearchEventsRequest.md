# SearchEventsRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**query** | **str** | Full-text search query | [optional] 
**filters** | [**SearchEventsRequestFilters**](SearchEventsRequestFilters.md) |  | [optional] 
**format** | **str** | Response format | [optional] [default to 'full']
**limit** | **int** | Max results | [optional] [default to 50]

## Example

```python
from omni_generated.models.search_events_request import SearchEventsRequest

# TODO update the JSON string below
json = "{}"
# create an instance of SearchEventsRequest from a JSON string
search_events_request_instance = SearchEventsRequest.from_json(json)
# print the JSON string representation of the object
print(SearchEventsRequest.to_json())

# convert the object into a dict
search_events_request_dict = search_events_request_instance.to_dict()
# create an instance of SearchEventsRequest from a dict
search_events_request_from_dict = SearchEventsRequest.from_dict(search_events_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


