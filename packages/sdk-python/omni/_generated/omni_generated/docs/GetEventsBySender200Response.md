# GetEventsBySender200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | [**List[ListEvents200ResponseItemsInner]**](ListEvents200ResponseItemsInner.md) |  | 
**meta** | [**GetEventsBySender200ResponseMeta**](GetEventsBySender200ResponseMeta.md) |  | 

## Example

```python
from omni_generated.models.get_events_by_sender200_response import GetEventsBySender200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetEventsBySender200Response from a JSON string
get_events_by_sender200_response_instance = GetEventsBySender200Response.from_json(json)
# print the JSON string representation of the object
print(GetEventsBySender200Response.to_json())

# convert the object into a dict
get_events_by_sender200_response_dict = get_events_by_sender200_response_instance.to_dict()
# create an instance of GetEventsBySender200Response from a dict
get_events_by_sender200_response_from_dict = GetEventsBySender200Response.from_dict(get_events_by_sender200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


