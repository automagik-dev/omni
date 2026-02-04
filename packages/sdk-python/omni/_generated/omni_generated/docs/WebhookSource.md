# WebhookSource


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
from omni_generated.models.webhook_source import WebhookSource

# TODO update the JSON string below
json = "{}"
# create an instance of WebhookSource from a JSON string
webhook_source_instance = WebhookSource.from_json(json)
# print the JSON string representation of the object
print(WebhookSource.to_json())

# convert the object into a dict
webhook_source_dict = webhook_source_instance.to_dict()
# create an instance of WebhookSource from a dict
webhook_source_from_dict = WebhookSource.from_dict(webhook_source_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


