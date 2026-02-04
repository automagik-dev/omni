# ListWebhookSources200ResponseItemsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** | Source UUID | 
**name** | **str** | Source name | 
**description** | **str** | Description | 
**expected_headers** | **Dict[str, bool]** | Expected headers | 
**enabled** | **bool** | Whether enabled | 
**created_at** | **datetime** | Creation timestamp | 
**updated_at** | **datetime** | Last update timestamp | 

## Example

```python
from omni_generated.models.list_webhook_sources200_response_items_inner import ListWebhookSources200ResponseItemsInner

# TODO update the JSON string below
json = "{}"
# create an instance of ListWebhookSources200ResponseItemsInner from a JSON string
list_webhook_sources200_response_items_inner_instance = ListWebhookSources200ResponseItemsInner.from_json(json)
# print the JSON string representation of the object
print(ListWebhookSources200ResponseItemsInner.to_json())

# convert the object into a dict
list_webhook_sources200_response_items_inner_dict = list_webhook_sources200_response_items_inner_instance.to_dict()
# create an instance of ListWebhookSources200ResponseItemsInner from a dict
list_webhook_sources200_response_items_inner_from_dict = ListWebhookSources200ResponseItemsInner.from_dict(list_webhook_sources200_response_items_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


