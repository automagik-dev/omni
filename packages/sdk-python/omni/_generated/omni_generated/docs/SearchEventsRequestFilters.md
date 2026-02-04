# SearchEventsRequestFilters


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**channel** | **List[str]** | Channel types | [optional] 
**instance_id** | **UUID** | Instance UUID | [optional] 
**person_id** | **UUID** | Person UUID | [optional] 
**event_type** | **List[str]** | Event types | [optional] 
**content_type** | **List[str]** | Content types | [optional] 
**direction** | **str** | Direction | [optional] 
**since** | **datetime** | Start date | [optional] 
**until** | **datetime** | End date | [optional] 

## Example

```python
from omni_generated.models.search_events_request_filters import SearchEventsRequestFilters

# TODO update the JSON string below
json = "{}"
# create an instance of SearchEventsRequestFilters from a JSON string
search_events_request_filters_instance = SearchEventsRequestFilters.from_json(json)
# print the JSON string representation of the object
print(SearchEventsRequestFilters.to_json())

# convert the object into a dict
search_events_request_filters_dict = search_events_request_filters_instance.to_dict()
# create an instance of SearchEventsRequestFilters from a dict
search_events_request_filters_from_dict = SearchEventsRequestFilters.from_dict(search_events_request_filters_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


