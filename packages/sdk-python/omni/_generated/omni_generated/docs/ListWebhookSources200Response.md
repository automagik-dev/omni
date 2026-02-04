# ListWebhookSources200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | [**List[ListWebhookSources200ResponseItemsInner]**](ListWebhookSources200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.list_webhook_sources200_response import ListWebhookSources200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ListWebhookSources200Response from a JSON string
list_webhook_sources200_response_instance = ListWebhookSources200Response.from_json(json)
# print the JSON string representation of the object
print(ListWebhookSources200Response.to_json())

# convert the object into a dict
list_webhook_sources200_response_dict = list_webhook_sources200_response_instance.to_dict()
# create an instance of ListWebhookSources200Response from a dict
list_webhook_sources200_response_from_dict = ListWebhookSources200Response.from_dict(list_webhook_sources200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


