# ListEventPayloads200ResponseItemsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** | Payload UUID | 
**event_id** | **UUID** | Event UUID | 
**stage** | **str** | Payload stage | 
**mime_type** | **str** | MIME type | 
**size_bytes** | **int** | Size in bytes | 
**has_data** | **bool** | Whether data is available | 
**created_at** | **datetime** | Creation timestamp | 

## Example

```python
from omni_generated.models.list_event_payloads200_response_items_inner import ListEventPayloads200ResponseItemsInner

# TODO update the JSON string below
json = "{}"
# create an instance of ListEventPayloads200ResponseItemsInner from a JSON string
list_event_payloads200_response_items_inner_instance = ListEventPayloads200ResponseItemsInner.from_json(json)
# print the JSON string representation of the object
print(ListEventPayloads200ResponseItemsInner.to_json())

# convert the object into a dict
list_event_payloads200_response_items_inner_dict = list_event_payloads200_response_items_inner_instance.to_dict()
# create an instance of ListEventPayloads200ResponseItemsInner from a dict
list_event_payloads200_response_items_inner_from_dict = ListEventPayloads200ResponseItemsInner.from_dict(list_event_payloads200_response_items_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


