# EventSearch


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**query** | **str** | Full-text search query | [optional] 
**filters** | [**SearchEventsRequestFilters**](SearchEventsRequestFilters.md) |  | [optional] 
**format** | **str** | Response format | [optional] [default to 'full']
**limit** | **int** | Max results | [optional] [default to 50]

## Example

```python
from omni_generated.models.event_search import EventSearch

# TODO update the JSON string below
json = "{}"
# create an instance of EventSearch from a JSON string
event_search_instance = EventSearch.from_json(json)
# print the JSON string representation of the object
print(EventSearch.to_json())

# convert the object into a dict
event_search_dict = event_search_instance.to_dict()
# create an instance of EventSearch from a dict
event_search_from_dict = EventSearch.from_dict(event_search_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


