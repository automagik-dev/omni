# UpdateWebhookSourceRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** | Unique source name | [optional] 
**description** | **str** | Description | [optional] 
**expected_headers** | **Dict[str, bool]** | Headers to validate | [optional] 
**enabled** | **bool** | Whether enabled | [optional] [default to True]

## Example

```python
from omni_generated.models.update_webhook_source_request import UpdateWebhookSourceRequest

# TODO update the JSON string below
json = "{}"
# create an instance of UpdateWebhookSourceRequest from a JSON string
update_webhook_source_request_instance = UpdateWebhookSourceRequest.from_json(json)
# print the JSON string representation of the object
print(UpdateWebhookSourceRequest.to_json())

# convert the object into a dict
update_webhook_source_request_dict = update_webhook_source_request_instance.to_dict()
# create an instance of UpdateWebhookSourceRequest from a dict
update_webhook_source_request_from_dict = UpdateWebhookSourceRequest.from_dict(update_webhook_source_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


