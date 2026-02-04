# ListEventPayloads200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | [**List[ListEventPayloads200ResponseItemsInner]**](ListEventPayloads200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.list_event_payloads200_response import ListEventPayloads200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ListEventPayloads200Response from a JSON string
list_event_payloads200_response_instance = ListEventPayloads200Response.from_json(json)
# print the JSON string representation of the object
print(ListEventPayloads200Response.to_json())

# convert the object into a dict
list_event_payloads200_response_dict = list_event_payloads200_response_instance.to_dict()
# create an instance of ListEventPayloads200Response from a dict
list_event_payloads200_response_from_dict = ListEventPayloads200Response.from_dict(list_event_payloads200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


